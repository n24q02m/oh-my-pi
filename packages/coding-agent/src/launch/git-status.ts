import * as path from "node:path";
import type { DaemonGitDiffStat, DaemonGitStatus } from "./protocol";

const DEFAULT_CACHE_TTL_MS = 2_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_MAX_ENTRIES = 128;

export interface GitStatusReaderOptions {
	cacheTtlMs?: number;
	commandTimeoutMs?: number;
	maxOutputBytes?: number;
	maxEntries?: number;
}

interface GitCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

interface CachedStatus {
	status: DaemonGitStatus;
	expiresAt: number;
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

function boundedMessage(value: string): string {
	const normalized = value.replaceAll(/\s+/gu, " ").trim();
	return normalized.length > 300 ? `${normalized.slice(0, 297)}...` : normalized;
}

async function readLimited(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			size += value.byteLength;
			if (size > maxBytes) throw new Error(`git output exceeds the ${maxBytes} byte limit`);
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const output = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return Buffer.from(output).toString("utf8");
}

async function runGit(args: readonly string[], options: Required<Pick<GitStatusReaderOptions, "commandTimeoutMs" | "maxOutputBytes">>): Promise<GitCommandResult> {
	const processRef = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		processRef.kill();
	}, options.commandTimeoutMs);
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			readLimited(processRef.stdout, options.maxOutputBytes),
			readLimited(processRef.stderr, options.maxOutputBytes),
			processRef.exited,
		]);
		if (timedOut) throw new Error(`git command timed out after ${options.commandTimeoutMs}ms`);
		return { stdout, stderr, exitCode };
	} catch (error) {
		if (!timedOut) {
			try {
				processRef.kill();
			} catch {
				// The process may have exited while output was being drained.
			}
		}
		if (timedOut) throw new Error(`git command timed out after ${options.commandTimeoutMs}ms`);
		await processRef.exited.catch(() => undefined);
		throw error instanceof Error ? error : new Error(String(error));
	} finally {
		clearTimeout(timer);
	}
}

function commandOptions(options: GitStatusReaderOptions): Required<Pick<GitStatusReaderOptions, "commandTimeoutMs" | "maxOutputBytes">> {
	return {
		commandTimeoutMs: positiveInteger(options.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS),
		maxOutputBytes: positiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES),
	};
}

function failedCommand(result: GitCommandResult): { code: string; message: string } {
	return {
		code: `git-exit-${result.exitCode}`,
		message: boundedMessage(result.stderr || result.stdout || `git exited with code ${result.exitCode}`),
	};
}

function shortStat(value: string): DaemonGitDiffStat | undefined {
	const files = /([0-9]+) files? changed/iu.exec(value);
	const insertions = /([0-9]+) insertions?\(\+\)/iu.exec(value);
	const deletions = /([0-9]+) deletions?\(-\)/iu.exec(value);
	if (!files && !insertions && !deletions) return undefined;
	return {
		files: files ? Number(files[1]) : 0,
		insertions: insertions ? Number(insertions[1]) : 0,
		deletions: deletions ? Number(deletions[1]) : 0,
	};
}

function addDiffStats(left: DaemonGitDiffStat | undefined, right: DaemonGitDiffStat | undefined): DaemonGitDiffStat | undefined {
	if (!left) return right;
	if (!right) return left;
	return {
		files: left.files + right.files,
		insertions: left.insertions + right.insertions,
		deletions: left.deletions + right.deletions,
	};
}

function commandOutput(result: GitCommandResult): string {
	return result.stdout.trim();
}

/** Bounded, shell-free git inspection with a short per-worktree cache. */
export class GitStatusCache {
	readonly #entries = new Map<string, CachedStatus>();
	readonly #inflight = new Map<string, Promise<DaemonGitStatus>>();
	readonly #options: GitStatusReaderOptions;

	constructor(options: GitStatusReaderOptions = {}) {
		this.#options = { ...options };
	}

	get(daemonName: string, worktreePath: string, refresh = false): Promise<DaemonGitStatus> {
		const canonicalPath = path.resolve(worktreePath);
		const now = Date.now();
		const cached = this.#entries.get(canonicalPath);
		if (!refresh && cached && cached.expiresAt > now) {
			return Promise.resolve({ ...cached.status, daemonName, cached: true });
		}
		const existing = this.#inflight.get(canonicalPath);
		if (existing) return existing.then(status => ({ ...status, daemonName, cached: false }));
		const promise = this.#read(daemonName, canonicalPath);
		this.#inflight.set(canonicalPath, promise);
		return promise.finally(() => this.#inflight.delete(canonicalPath));
	}

	invalidate(worktreePath: string): void {
		this.#entries.delete(path.resolve(worktreePath));
	}

	clear(): void {
		this.#entries.clear();
	}

	async #read(daemonName: string, worktreePath: string): Promise<DaemonGitStatus> {
		const refreshedAt = Date.now();
		const status: DaemonGitStatus = {
			daemonName,
			worktreePath,
			detached: false,
			dirty: false,
			refreshedAt,
			cached: false,
		};
		const processOptions = commandOptions(this.#options);
		const run = async (args: readonly string[]): Promise<GitCommandResult> => runGit(["-C", worktreePath, ...args], processOptions);
		try {
			const root = await run(["rev-parse", "--show-toplevel"]);
			if (root.exitCode !== 0) {
				status.error = failedCommand(root);
				return this.#cache(status);
			}
			status.repositoryRoot = commandOutput(root);

			const [gitDir, commonDir, head, branch, porcelain] = await Promise.all([
				run(["rev-parse", "--git-dir"]),
				run(["rev-parse", "--git-common-dir"]),
				run(["rev-parse", "--verify", "HEAD"]),
				run(["symbolic-ref", "--quiet", "--short", "HEAD"]),
				run(["status", "--porcelain=v1", "-z", "--untracked-files=normal"]),
			]);
			if (gitDir.exitCode === 0) status.gitDir = path.resolve(worktreePath, commandOutput(gitDir));
			if (commonDir.exitCode === 0) status.commonDir = path.resolve(worktreePath, commandOutput(commonDir));
			if (head.exitCode === 0) status.head = commandOutput(head);
			if (branch.exitCode === 0 && commandOutput(branch)) status.branch = commandOutput(branch);
			status.detached = status.branch === undefined;
			status.dirty = porcelain.exitCode === 0 && porcelain.stdout.length > 0;

			const upstream = await run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
			if (upstream.exitCode === 0 && commandOutput(upstream)) {
				status.upstream = commandOutput(upstream);
				const counts = await run(["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
				if (counts.exitCode === 0) {
					const [behind, ahead] = commandOutput(counts).split(/\s+/u).map(Number);
					if (Number.isFinite(ahead)) status.ahead = ahead;
					if (Number.isFinite(behind)) status.behind = behind;
				}
			}

			const [workingDiff, stagedDiff] = await Promise.all([
				run(["diff", "--shortstat"]),
				run(["diff", "--cached", "--shortstat"]),
			]);
			status.diffStat = addDiffStats(
				workingDiff.exitCode === 0 ? shortStat(workingDiff.stdout) : undefined,
				stagedDiff.exitCode === 0 ? shortStat(stagedDiff.stdout) : undefined,
			);
			return this.#cache(status);
		} catch (error) {
			status.error = { code: "git-read-failed", message: boundedMessage(error instanceof Error ? error.message : String(error)) };
			return this.#cache(status);
		}
	}

	#cache(status: DaemonGitStatus): DaemonGitStatus {
		const maxEntries = positiveInteger(this.#options.maxEntries, DEFAULT_MAX_ENTRIES);
		while (this.#entries.size >= maxEntries) {
			const oldest = this.#entries.keys().next().value;
			if (oldest === undefined) break;
			this.#entries.delete(oldest);
		}
		const ttlMs = positiveInteger(this.#options.cacheTtlMs, DEFAULT_CACHE_TTL_MS);
		this.#entries.set(status.worktreePath, { status, expiresAt: Date.now() + ttlMs });
		return status;
	}
}

const sharedGitStatusCache = new GitStatusCache();

/** Read one daemon's repository state using the shared bounded cache. */
export function readDaemonGitStatus(
	daemonName: string,
	worktreePath: string,
	options: { refresh?: boolean; cache?: GitStatusCache } = {},
): Promise<DaemonGitStatus> {
	return (options.cache ?? sharedGitStatusCache).get(daemonName, worktreePath, options.refresh === true);
}
