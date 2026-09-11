import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
	RemoteClient,
	type RemoteGitStatus,
	type RemoteOperation,
	type RemoteSnapshot,
	type RemoteSpec,
} from "./client";
import { createDeviceStore, type DeviceStore } from "./device-store";
import "../components/shell/shell.css";
import "./remote.css";

export interface RemoteAppProps {
	client?: RemoteClient;
	deviceStore?: DeviceStore;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function formatDate(value: number): string {
	return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatGit(status: RemoteGitStatus): string {
	if (status.error) return status.error.message;
	const branch = status.detached ? "detached HEAD" : (status.branch ?? "no branch");
	const dirty = status.dirty ? "dirty" : "clean";
	const counts = status.ahead !== undefined || status.behind !== undefined ? ` ↑${status.ahead ?? 0} ↓${status.behind ?? 0}` : "";
	const diff = status.diffStat
		? ` · ${status.diffStat.files} files +${status.diffStat.insertions}/-${status.diffStat.deletions}`
		: "";
	return `${branch} · ${dirty}${counts}${diff}`;
}

function capabilityLabel(capability: string): string {
	return capability.replaceAll("-", " ");
}

function daemonStatusLabel(daemon: RemoteSnapshot): string {
	const pid = daemon.pid === undefined ? "" : ` · pid ${daemon.pid}`;
	return `${daemon.state}${pid}`;
}

export function canControl(capabilities: readonly string[]): boolean {
	return capabilities.includes("control-session");
}

export function RemoteApp({ client: providedClient, deviceStore: providedStore }: RemoteAppProps): ReactNode {
	const [store] = useState(() => providedStore ?? createDeviceStore());
	const [client] = useState(() => providedClient ?? new RemoteClient({ deviceStore: store }));
	const subscribe = useCallback((listener: () => void) => client.subscribe(listener), [client]);
	const getSnapshot = useCallback(() => client.getSnapshot(), [client]);
	const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const [token, setToken] = useState("");
	const [selectedName, setSelectedName] = useState<string | null>(null);
	const [selectedSpec, setSelectedSpec] = useState<RemoteSpec | null>(null);
	const [git, setGit] = useState<RemoteGitStatus | null>(null);
	const [logs, setLogs] = useState<string | null>(null);
	const [sendText, setSendText] = useState("");
	const [actionError, setActionError] = useState<string | null>(null);

	useEffect(() => {
		if (client.getSnapshot().phase === "unauthenticated" && client.hasCapability("observe") === false) client.connect();
		return () => client.close();
	}, [client]);

	useEffect(() => {
		if (!selectedName || snapshot.phase !== "live") return;
		setSelectedSpec(null);
		setGit(null);
		setLogs(null);
		void client
			.request({ op: "describe", name: selectedName })
			.then(result => {
				if (result.op === "describe") setSelectedSpec(result.spec);
			})
			.catch(error => setActionError(errorText(error)));
		if (client.hasCapability("git-read")) {
			void client
				.request({ op: "git-status", name: selectedName, refresh: true })
				.then(result => {
					if (result.op === "git-status") setGit(result.status);
				})
				.catch(error => setActionError(errorText(error)));
		}
	}, [client, selectedName, snapshot.phase]);

	const selected = useMemo(
		() => snapshot.daemons.find(daemon => daemon.name === selectedName) ?? null,
		[snapshot.daemons, selectedName],
	);

	const saveAndConnect = (): void => {
		try {
			store.write(token.trim());
			setActionError(null);
			client.connect();
		} catch (error) {
			setActionError(errorText(error));
		}
	};

	const request = (operation: RemoteOperation): void => {
		setActionError(null);
		void client
			.request(operation)
			.then(result => {
				if (result.op === "git-status") setGit(result.status);
			})
			.catch(error => setActionError(errorText(error)));
	};

	const refresh = (): void => request({ op: "list" });
	const loadLogs = (): void => {
		if (!selectedName) return;
		setActionError(null);
		void client
			.request({ op: "logs", name: selectedName, lines: 100, head: false, follow: false, timeoutMs: 30_000 })
			.then(result => {
				if (result.op === "logs") setLogs(result.text);
			})
			.catch(error => setActionError(errorText(error)));
	};

	if (snapshot.phase === "unauthenticated" || snapshot.phase === "revoked") {
		return (
			<div className="sh-app remote-app">
				<main className="remote-login">
					<div className="remote-mark">omp</div>
					<h1>Remote supervisor</h1>
					<p className="remote-muted">Paste a paired device token to inspect and control this host.</p>
					<label className="remote-field">
						<span>Device token</span>
						<input
							autoComplete="off"
							spellCheck={false}
							value={token}
							onChange={event => setToken(event.target.value)}
							onKeyDown={event => {
								if (event.key === "Enter") saveAndConnect();
							}}
						/>
					</label>
					<button className="sh-btn sh-btn-primary" type="button" onClick={saveAndConnect}>
						Connect
					</button>
					{snapshot.error && <p className="remote-error">{snapshot.error}</p>}
					{actionError && <p className="remote-error">{actionError}</p>}
				</main>
			</div>
		);
	}

	return (
		<div className="sh-app remote-app">
			<header className="remote-header">
				<div>
					<div className="remote-brand">omp remote supervisor</div>
					<div className="remote-project">{snapshot.projectDir ?? "connecting"}</div>
				</div>
				<div className="remote-header-actions">
					<span className={`remote-status remote-status-${snapshot.phase}`}>{snapshot.phase}</span>
					<button className="sh-btn" type="button" onClick={refresh} disabled={snapshot.phase !== "live"}>
						Refresh
					</button>
					<button className="sh-btn" type="button" onClick={() => client.logout()}>
						Log out
					</button>
				</div>
			</header>
			<div className="remote-capabilities" aria-label="Device capabilities">
				{snapshot.capabilities.map(capability => (
					<span className="sh-chip" key={capability}>
						{capabilityLabel(capability)}
					</span>
				))}
			</div>
			<main className="remote-main">
				<section className="remote-daemon-list" aria-label="Supervised daemons">
					{snapshot.daemons.length === 0 && <p className="remote-muted">No supervised daemons.</p>}
					{snapshot.daemons.map(daemon => (
						<button
							className={`remote-daemon-card${selectedName === daemon.name ? " remote-daemon-selected" : ""}`}
							key={daemon.name}
							type="button"
							onClick={() => setSelectedName(daemon.name)}
						>
							<span className="remote-daemon-name">{daemon.name}</span>
							<span className="remote-daemon-state">{daemonStatusLabel(daemon)}</span>
							<span className="remote-daemon-meta">
								restarts {daemon.restartCount} · {daemon.detached ? "detached" : daemon.persist ? "persistent" : "ephemeral"}
							</span>
						</button>
					))}
				</section>
				<section className="remote-detail" aria-live="polite">
					{!selected && <p className="remote-muted">Select a daemon to inspect it.</p>}
					{selected && (
						<>
							<div className="remote-detail-heading">
								<div>
									<h2>{selected.name}</h2>
									<p className="remote-muted">{daemonStatusLabel(selected)}</p>
								</div>
								{canControl(snapshot.capabilities) && (
									<div className="remote-controls">
										<button className="sh-btn sh-btn-stop" type="button" onClick={() => request({ op: "stop", name: selected.name, timeoutMs: 5_000 })}>
											Stop
										</button>
										<button className="sh-btn" type="button" onClick={() => request({ op: "restart", name: selected.name })}>
											Restart
										</button>
										<button className="sh-btn" type="button" onClick={() => request({ op: "resume", name: selected.name })}>
											Resume
										</button>
									</div>
								)}
							</div>
							<div className="remote-facts">
								<div><span>PID</span><code>{selected.pid ?? "-"}</code></div>
								<div><span>Working directory</span><code>{selectedSpec?.cwd ?? "loading…"}</code></div>
								<div><span>Command</span><code>{selectedSpec ? [selectedSpec.application, ...selectedSpec.args].join(" ") : "loading…"}</code></div>
								{git && <div><span>Git</span><code>{formatGit(git)}</code><small>refreshed {formatDate(git.refreshedAt)}</small></div>}
							</div>
							<div className="remote-section-actions">
								<button className="sh-btn" type="button" onClick={loadLogs}>Load logs</button>
								{client.hasCapability("git-read") && <button className="sh-btn" type="button" onClick={() => request({ op: "git-status", name: selected.name, refresh: true })}>Refresh git</button>}
							</div>
							{canControl(snapshot.capabilities) && (
								<div className="remote-send">
									<input value={sendText} onChange={event => setSendText(event.target.value)} placeholder="stdin text" />
									<button className="sh-btn" type="button" disabled={!sendText} onClick={() => { request({ op: "send", name: selected.name, data: sendText }); setSendText(""); }}>Send</button>
								</div>
							)}
							{logs !== null && <pre className="remote-logs">{logs || "(no output)"}</pre>}
						</>
					)}
				</section>
			</main>
			{snapshot.approvals.length > 0 && (
				<section className="remote-approvals" aria-label="Pending approvals">
					<h2>Approval required</h2>
					{snapshot.approvals.map(approval => (
						<div className="remote-approval" key={approval.id}>
							<div><strong>{approval.summary}</strong><span>{approval.daemonName} · expires {formatDate(approval.expiresAt)}</span></div>
							{client.hasCapability("approve") && (
								<div className="remote-controls">
									<button className="sh-btn sh-btn-primary" type="button" onClick={() => client.approve(approval.id, "approve")}>Approve</button>
									<button className="sh-btn sh-btn-stop" type="button" onClick={() => client.approve(approval.id, "deny")}>Deny</button>
								</div>
							)}
						</div>
					))}
				</section>
			)}
			{actionError && <p className="remote-error remote-error-toast">{actionError}</p>}
		</div>
	);
}
