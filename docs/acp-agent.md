# ACP agent integration

Oh My Pi (`omp`) includes an [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) server. The `acp` command is a stdio adapter for editors and other ACP clients; it uses the same session engine, provider configuration, tools, and approval settings as a normal OMP launch.

This guide covers the current `omp acp` behavior and the steps for using it from Zed.

## Start the ACP server

Run the server as a child process of an ACP client:

```sh
omp acp
```

The server speaks JSON-RPC over newline-delimited stdio. Its stdout is reserved for protocol messages, so do not pipe human-readable output into that stream. When started from an interactive terminal, OMP writes a short diagnostic to stderr explaining that the process is waiting for an ACP client.

The shared parser also accepts `--mode acp`:

```sh
omp --mode acp
```

The installed `omp --help` output does not advertise `acp` among the `--mode` values, so prefer `omp acp`, the documented command surface. Both forms enter the same ACP server path in the checked-in source.

Check the installed binary for the exact shared launch flags:

```sh
omp --help
omp acp --help
```

Shared launch flags such as `--cwd`, `--profile`, `--config`, `--model`, `--tools`, `--approval-mode`, `--auto-approve`, `--yolo`, and `--session-dir` can be supplied when the ACP process is launched. The ACP command itself does not take a prompt on stdin: stdin and stdout belong to the ACP transport.

## Configure Zed

Zed starts an external ACP agent from its `agent_servers` settings. The current Zed documentation describes two paths:

- **ACP Registry:** open the Command Palette and choose `zed: acp registry`, or open Agent Settings and choose **Install from Registry**. This is the recommended way to install an agent when it is listed there.
- **Custom Agent:** for an agent that is not in the registry, choose **Agent Settings → External Agents → Add Agent → Add Custom Agent**, or edit `settings.json` directly.

Oh My Pi can be registered as a custom agent with the following entry:

```json
{
  "agent_servers": {
    "oh-my-pi": {
      "type": "custom",
      "command": "omp",
      "args": ["acp"]
    }
  }
}
```

`command` is the executable Zed starts, and `args` are passed to it. Use an absolute executable path if Zed does not inherit the shell `PATH` that contains `omp`. The optional `env` object can provide process environment variables, but keep credentials in the provider's supported auth store or environment mechanism rather than committing them to `settings.json`.

After saving settings, select **Oh My Pi** from the new-thread menu in Zed's Agent Panel or Threads Sidebar. If the process does not start or the handshake fails, inspect Zed's ACP logs (`dev: open acp logs` in the Command Palette) and verify that the configured command can run from a terminal.

The ACP Registry and custom-agent settings are Zed features. OMP's integration does not require a Zed extension or a separate OMP plugin.

## Session lifecycle

An ACP process can serve more than one session. Zed (or another client) creates a session with `session/new`, supplying an absolute workspace directory and, optionally, client-owned MCP server definitions. OMP returns a session ID plus the available configuration options and modes.

The server advertises these session capabilities:

- `list` — list stored sessions, in pages of up to 50 entries;
- `load` — load a stored session and replay its history to the client;
- `resume` — reopen a stored session in a requested workspace;
- `fork` — create a new session from an existing one; and
- `close` — close the active session.

Each `session/new` request creates a managed OMP session for its requested workspace. `session/load`, `session/resume`, and `unstable_session/fork` operate on stored session state; they do not merge unrelated editor threads. Session files use OMP's normal session storage, or the directory supplied by `--session-dir` when the ACP process is launched.

A session turn is sent with ACP `session/prompt`. Text and image prompt content are supported. While a turn is running, OMP streams updates through ACP; cancellation is propagated to the underlying OMP session before the turn is considered complete.

## Authentication

During ACP initialization, OMP advertises an `agent` method:

- **Use existing local credentials** — OMP uses provider keys or OAuth state already configured in the local OMP profile (normally under `~/.omp`). Authenticate the provider with OMP before starting the ACP process if the profile has no usable credentials.

If the ACP client advertises terminal-auth support, OMP also advertises a `terminal` method:

- **Set up Oh My Pi in terminal** — the client may relaunch OMP with the protocol-provided argument `--acp-terminal-auth`. That opens the OMP terminal UI so you can add provider keys and select models, then return to the ACP client.

OMP accepts only an authentication method that it advertised during initialization. Selecting an unknown method fails rather than silently proceeding without authentication. Zed remains the host UI; provider authentication and model configuration belong to OMP and the provider profile, not to Zed's `agent_servers` entry.

## Tool routing and approvals

When the client advertises the relevant ACP capabilities, OMP can route operations through the client bridge:

- file reads use the client's filesystem read capability;
- file writes use the client's filesystem write capability; and
- shell commands use the client's terminal capability.

The ACP permission gate is narrower than capability routing. When a client bridge is available, `session/request_permission` is used for `bash`, `delete`, and `move` calls, plus `edit` calls whose operation deletes or moves a file. A regular edit that does not have a destructive delete/move intent is not automatically covered by this gate. If the client does not expose a filesystem or terminal capability, OMP keeps the corresponding local tool path instead of assuming that the capability exists.

Approval mode is resolved with the normal OMP settings precedence. A runtime flag overrides `--config` overlays, which override project settings, which override the global configuration. The supported modes are:

| Mode | Behavior |
| --- | --- |
| `always-ask` | Automatically allows read tools; prompts for writes and execution. |
| `write` | Automatically allows reads and writes; prompts for execution. |
| `yolo` | Automatically allows all ordinary tool calls. |

For an ACP process, configure approval explicitly when unattended operation is intended:

```sh
omp acp --approval-mode yolo
omp acp --auto-approve
omp acp --yolo
omp acp --config ./acp-yolo.yml
```

The last form expects the overlay to contain:

```yaml
tools:
  approvalMode: yolo
```

An explicit tool policy can still deny or prompt a call. For the ACP-gated tools above, explicit `yolo` or auto-approve skips the client permission gate unless the per-tool policy explicitly requires a prompt or deny. A tool's critical safety policy can also require a prompt; `yolo` is not a replacement for a client or provider safety check. When the gate is active, the client can select an offered option or cancel the call.

Plan mode has a separate ACP confirmation step when the client supports `elicitation.form`. OMP asks the client to approve or refine the proposed plan; dismissal or refinement keeps plan mode active. When the client does not support `elicitation.form`, OMP auto-approves the plan proposal so plan mode has a way to exit.

## Troubleshooting

- If Zed cannot find OMP, replace `"command": "omp"` with the full path to the executable and keep `"args": ["acp"]`.
- If the ACP process appears silent when run by hand, that is expected: stdout carries JSON-RPC. Start it from Zed or another ACP client.
- If a tool is not routed through Zed, check the client capabilities negotiated during initialization and the active approval mode.
- If a provider call fails after a successful ACP handshake, authenticate the provider in the OMP profile and verify the selected model separately from Zed.

## References

- [Zed: External Agents](https://zed.dev/docs/ai/external-agents)
- [Zed: Agent Settings](https://zed.dev/docs/ai/agent-settings)
- [Agent Client Protocol](https://agentclientprotocol.com/)
- [Oh My Pi tool approval modes](./approval-mode.md)
- [Oh My Pi CLI reference](./cli-reference.md)
