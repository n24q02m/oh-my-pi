import { isEnoent, logger } from "@oh-my-pi/pi-utils";
export interface BoundedCommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	stdoutTruncated: boolean;
	stderrTruncated: boolean;
}

export interface BoundedCommandOptions {
	cwd?: string;
	env?: Record<string, string>;
	maxStdoutBytes?: number;
	maxStderrBytes?: number;
	timeout?: number;
	logNonZeroExit?: boolean;
}

const DEFAULT_MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 1024 * 1024;

function sanitizeMaxBytes(value: number | undefined, defaultValue: number): number {
	if (value === undefined || !Number.isFinite(value) || value <= 0) {
		return defaultValue;
	}
	return Math.floor(value);
}

async function collectLimited(
	stream: ReadableStream<Uint8Array> | null,
	maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
	if (!stream) {
		return { text: "", truncated: false };
	}

	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let bytesRead = 0;
	let truncated = false;

	while (true) {
		const next = await reader.read();
		if (next.done) break;
		const chunk = next.value;
		if (!chunk || chunk.byteLength === 0) continue;

		if (!truncated) {
			const remaining = maxBytes - bytesRead;
			if (remaining <= 0) {
				truncated = true;
			} else if (chunk.byteLength <= remaining) {
				chunks.push(chunk);
				bytesRead += chunk.byteLength;
			} else {
				chunks.push(chunk.slice(0, remaining));
				bytesRead += remaining;
				truncated = true;
			}
		}
	}

	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	if (total === 0) {
		return { text: "", truncated };
	}

	const buffer = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		buffer.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { text: new TextDecoder().decode(buffer), truncated };
}

export async function runBoundedGitCommand(
	args: string[],
	options: BoundedCommandOptions = {},
): Promise<BoundedCommandResult> {
	const maxStdoutBytes = sanitizeMaxBytes(options.maxStdoutBytes, DEFAULT_MAX_STDOUT_BYTES);
	const maxStderrBytes = sanitizeMaxBytes(options.maxStderrBytes, DEFAULT_MAX_STDERR_BYTES);

	try {
		const child = Bun.spawn(["git", ...args], {
			cwd: options.cwd,
			env: options.env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			timeout: options.timeout,
			windowsHide: true,
		});

		const [stdout, stderr, exitCode] = await Promise.all([
			collectLimited(child.stdout, maxStdoutBytes),
			collectLimited(child.stderr, maxStderrBytes),
			child.exited,
		]);

		if (options.logNonZeroExit && exitCode !== 0 && stderr.text.length > 0) {
			logger.warn("runBoundedGitCommand: command finished with non-zero exit", {
				args,
				exitCode,
				stderr: stderr.text.slice(0, 2000),
			});
		}

		return {
			exitCode: exitCode ?? 0,
			stdout: stdout.text,
			stderr: stderr.text,
			stdoutTruncated: stdout.truncated,
			stderrTruncated: stderr.truncated,
		};
	} catch (error) {
		if (isEnoent(error)) {
			return {
				exitCode: 127,
				stdout: "",
				stderr: `Failed to execute git command: ${error.message}`,
				stdoutTruncated: false,
				stderrTruncated: false,
			};
		}
		throw error;
	}
}
