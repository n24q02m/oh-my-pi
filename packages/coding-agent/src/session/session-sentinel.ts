import { logger } from "@oh-my-pi/pi-utils";
import { resolveWorkerSpawnCmd, workerEnvFromParent } from "../subprocess/worker-client";
import {
	findLastSessionLiveness,
	hasSessionExitAfter,
	SESSION_EXIT_CUSTOM_TYPE,
	type SessionExitData,
} from "./exit-diagnostics";
import { SessionManager } from "./session-manager";
import {
	SESSION_SENTINEL_PARENT_PID_ENV,
	SESSION_SENTINEL_SESSION_FILE_ENV,
	SESSION_SENTINEL_WORKER_ARG,
} from "./session-sentinel-protocol";

const SENTINEL_EXIT_REASON = "parent_disappeared";
const SENTINEL_PARENT_POLL_MS = 250;

interface SessionExitSentinelOptions {
	sessionFile: string;
	parentPid: number;
	parentIsAlive?: (parentPid: number) => boolean;
}

function isProcessAlive(parentPid: number): boolean {
	try {
		process.kill(parentPid, 0);
		return true;
	} catch (error) {
		return !(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH");
	}
}

function readParentPid(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parentPid = Number(value);
	if (!Number.isSafeInteger(parentPid) || parentPid <= 0) return undefined;
	return parentPid;
}

/**
 * Records a single abnormal session exit after a sentinel observes that its
 * parent disappeared without an OMP teardown record.
 */
export function recordAbnormalSessionExit(sessionManager: SessionManager): boolean {
	const liveness = findLastSessionLiveness(sessionManager.getBranch());
	if (!liveness || hasSessionExitAfter(sessionManager.getBranch(), liveness.index)) return false;
	const data: SessionExitData = {
		reason: SENTINEL_EXIT_REASON,
		kind: "abnormal",
		recordedAt: new Date().toISOString(),
		lastLiveness: liveness.data,
		processOutcome: { observation: "unknown", observedBy: "sentinel" },
	};
	sessionManager.appendCustomEntry(SESSION_EXIT_CUSTOM_TYPE, data);
	sessionManager.flushSync();
	return true;
}

/**
 * Waits for a parent process to disappear, then durably records an unknown
 * outcome if the session still has an active liveness operation.
 */
export async function runSessionExitSentinel(options: SessionExitSentinelOptions): Promise<boolean> {
	if (!Number.isSafeInteger(options.parentPid) || options.parentPid <= 0) {
		throw new Error("Session sentinel requires a positive parent PID");
	}
	const parentIsAlive = options.parentIsAlive ?? isProcessAlive;
	while (parentIsAlive(options.parentPid)) {
		await Bun.sleep(SENTINEL_PARENT_POLL_MS);
	}
	const sessionManager = await SessionManager.open(options.sessionFile, undefined, undefined, {
		suppressBreadcrumb: true,
	});
	try {
		return recordAbnormalSessionExit(sessionManager);
	} finally {
		await sessionManager.close();
	}
}

export async function runSessionExitSentinelFromEnvironment(env: NodeJS.ProcessEnv = process.env): Promise<void> {
	const sessionFile = env[SESSION_SENTINEL_SESSION_FILE_ENV];
	const parentPid = readParentPid(env[SESSION_SENTINEL_PARENT_PID_ENV]);
	if (!sessionFile || parentPid === undefined) {
		logger.warn("Session exit sentinel started without a valid parent contract");
		return;
	}
	try {
		const recorded = await runSessionExitSentinel({ sessionFile, parentPid });
		if (recorded) logger.warn("Session exit sentinel recorded an unobservable parent outcome");
	} catch (error) {
		logger.warn("Session exit sentinel failed", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export function startSessionExitSentinel(sessionFile: string): (() => void) | undefined {
	const { cmd, cwd } = resolveWorkerSpawnCmd(SESSION_SENTINEL_WORKER_ARG);
	try {
		const proc = Bun.spawn(cmd, {
			cwd,
			env: workerEnvFromParent({
				[SESSION_SENTINEL_PARENT_PID_ENV]: String(process.pid),
				[SESSION_SENTINEL_SESSION_FILE_ENV]: sessionFile,
			}),
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
			detached: true,
		});
		proc.unref();
		let stopped = false;
		return () => {
			if (stopped) return;
			stopped = true;
			try {
				proc.kill();
			} catch (error) {
				logger.warn("Failed to stop session exit sentinel", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		};
	} catch (error) {
		logger.warn("Failed to start session exit sentinel", {
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}
