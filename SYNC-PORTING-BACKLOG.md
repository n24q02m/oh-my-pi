# SYNC-PORTING-BACKLOG (upstream-first redo 2026-09-19)

Baseline: merge commit mirrors upstream/main (e1a86ce) exactly.
Every fork delta below was REMOVED from the baseline and must be ported
explicitly, verified by gate, one commit per feature cluster.

Source: git diff --name-status f06d289338 c0c124ae19 (fork churn vs merge-base).


## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	.gitattributes

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	.github/ISSUE_TEMPLATE/bug_report.yml
- A	.github/ISSUE_TEMPLATE/config.yml
- A	.github/ISSUE_TEMPLATE/feature_request.yml
- A	.github/ISSUE_TEMPLATE/question.yml
- A	.github/PULL_REQUEST_TEMPLATE.md
- A	.github/SECURITY.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	.github/workflows/ci.yml

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	.github/workflows/fork-crash-safe-session-lifecycle.yml
- A	.github/workflows/fork-crash-safe-session-replay.yml

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	.gitignore

## Fork-renamed files (port = map to upstream layout)
- R093	.claude/commands/release.md	.omp/commands/release.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	.omp/commands/triage.md
- A	.omp/skills/semantic-compression/SKILL.md
- A	.omp/skills/system-prompts/SKILL.md

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	.prettierignore
- D	.prettierrc

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	AGENTS.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	Cargo.lock
- A	Cargo.toml

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	LICENSE
- M	README.md
- M	biome.json
- M	bun.lock

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	bunfig.toml
- A	crates/brush-builtins-vendored/Cargo.lock
- A	crates/brush-builtins-vendored/Cargo.toml
- A	crates/brush-builtins-vendored/LICENSE
- A	crates/brush-builtins-vendored/README.md
- A	crates/brush-builtins-vendored/src/alias.rs
- A	crates/brush-builtins-vendored/src/bg.rs
- A	crates/brush-builtins-vendored/src/bind.rs
- A	crates/brush-builtins-vendored/src/break_.rs
- A	crates/brush-builtins-vendored/src/brushinfo.rs
- A	crates/brush-builtins-vendored/src/builder.rs
- A	crates/brush-builtins-vendored/src/builtin_.rs
- A	crates/brush-builtins-vendored/src/cd.rs
- A	crates/brush-builtins-vendored/src/colon.rs
- A	crates/brush-builtins-vendored/src/command.rs
- A	crates/brush-builtins-vendored/src/complete.rs
- A	crates/brush-builtins-vendored/src/continue_.rs
- A	crates/brush-builtins-vendored/src/declare.rs
- A	crates/brush-builtins-vendored/src/dirs.rs
- A	crates/brush-builtins-vendored/src/dot.rs
- A	crates/brush-builtins-vendored/src/echo.rs
- A	crates/brush-builtins-vendored/src/enable.rs
- A	crates/brush-builtins-vendored/src/eval.rs
- A	crates/brush-builtins-vendored/src/exec.rs
- A	crates/brush-builtins-vendored/src/exit.rs
- A	crates/brush-builtins-vendored/src/export.rs
- A	crates/brush-builtins-vendored/src/factory.rs
- A	crates/brush-builtins-vendored/src/false_.rs
- A	crates/brush-builtins-vendored/src/fc.rs
- A	crates/brush-builtins-vendored/src/fg.rs
- A	crates/brush-builtins-vendored/src/getopts.rs
- A	crates/brush-builtins-vendored/src/hash.rs
- A	crates/brush-builtins-vendored/src/help.rs
- A	crates/brush-builtins-vendored/src/history.rs
- A	crates/brush-builtins-vendored/src/jobs.rs
- A	crates/brush-builtins-vendored/src/kill.rs
- A	crates/brush-builtins-vendored/src/let_.rs
- A	crates/brush-builtins-vendored/src/lib.rs
- A	crates/brush-builtins-vendored/src/mapfile.rs
- A	crates/brush-builtins-vendored/src/popd.rs
- A	crates/brush-builtins-vendored/src/printf.rs
- A	crates/brush-builtins-vendored/src/pushd.rs
- A	crates/brush-builtins-vendored/src/pwd.rs
- A	crates/brush-builtins-vendored/src/read.rs
- A	crates/brush-builtins-vendored/src/return_.rs
- A	crates/brush-builtins-vendored/src/set.rs
- A	crates/brush-builtins-vendored/src/shift.rs
- A	crates/brush-builtins-vendored/src/shopt.rs
- A	crates/brush-builtins-vendored/src/suspend.rs
- A	crates/brush-builtins-vendored/src/test.rs
- A	crates/brush-builtins-vendored/src/times.rs
- A	crates/brush-builtins-vendored/src/trap.rs
- A	crates/brush-builtins-vendored/src/true_.rs
- A	crates/brush-builtins-vendored/src/type_.rs
- A	crates/brush-builtins-vendored/src/ulimit.rs
- A	crates/brush-builtins-vendored/src/umask.rs
- A	crates/brush-builtins-vendored/src/unalias.rs
- A	crates/brush-builtins-vendored/src/unimp.rs
- A	crates/brush-builtins-vendored/src/unset.rs
- A	crates/brush-builtins-vendored/src/wait.rs
- A	crates/brush-core-vendored/Cargo.lock
- A	crates/brush-core-vendored/Cargo.toml
- A	crates/brush-core-vendored/LICENSE
- A	crates/brush-core-vendored/README.md
- A	crates/brush-core-vendored/src/arithmetic.rs
- A	crates/brush-core-vendored/src/braceexpansion.rs
- A	crates/brush-core-vendored/src/builtins.rs
- A	crates/brush-core-vendored/src/commands.rs
- A	crates/brush-core-vendored/src/completion.rs
- A	crates/brush-core-vendored/src/env.rs
- A	crates/brush-core-vendored/src/error.rs
- A	crates/brush-core-vendored/src/escape.rs
- A	crates/brush-core-vendored/src/expansion.rs
- A	crates/brush-core-vendored/src/extendedtests.rs
- A	crates/brush-core-vendored/src/functions.rs
- A	crates/brush-core-vendored/src/history.rs
- A	crates/brush-core-vendored/src/interfaces.rs
- A	crates/brush-core-vendored/src/interfaces/keybindings.rs
- A	crates/brush-core-vendored/src/interp.rs
- A	crates/brush-core-vendored/src/jobs.rs
- A	crates/brush-core-vendored/src/keywords.rs
- A	crates/brush-core-vendored/src/lib.rs
- A	crates/brush-core-vendored/src/namedoptions.rs
- A	crates/brush-core-vendored/src/openfiles.rs
- A	crates/brush-core-vendored/src/options.rs
- A	crates/brush-core-vendored/src/pathcache.rs
- A	crates/brush-core-vendored/src/pathsearch.rs
- A	crates/brush-core-vendored/src/patterns.rs
- A	crates/brush-core-vendored/src/processes.rs
- A	crates/brush-core-vendored/src/prompt.rs
- A	crates/brush-core-vendored/src/regex.rs
- A	crates/brush-core-vendored/src/results.rs
- A	crates/brush-core-vendored/src/scripts.rs
- A	crates/brush-core-vendored/src/shell.rs
- A	crates/brush-core-vendored/src/sys.rs
- A	crates/brush-core-vendored/src/sys/fs.rs
- A	crates/brush-core-vendored/src/sys/hostname.rs
- A	crates/brush-core-vendored/src/sys/stubs.rs
- A	crates/brush-core-vendored/src/sys/stubs/commands.rs
- A	crates/brush-core-vendored/src/sys/stubs/fd.rs
- A	crates/brush-core-vendored/src/sys/stubs/fs.rs
- A	crates/brush-core-vendored/src/sys/stubs/input.rs
- A	crates/brush-core-vendored/src/sys/stubs/network.rs
- A	crates/brush-core-vendored/src/sys/stubs/pipes.rs
- A	crates/brush-core-vendored/src/sys/stubs/process.rs
- A	crates/brush-core-vendored/src/sys/stubs/resource.rs
- A	crates/brush-core-vendored/src/sys/stubs/signal.rs
- A	crates/brush-core-vendored/src/sys/stubs/terminal.rs
- A	crates/brush-core-vendored/src/sys/stubs/users.rs
- A	crates/brush-core-vendored/src/sys/tokio_process.rs
- A	crates/brush-core-vendored/src/sys/unix.rs
- A	crates/brush-core-vendored/src/sys/unix/commands.rs
- A	crates/brush-core-vendored/src/sys/unix/fd.rs
- A	crates/brush-core-vendored/src/sys/unix/fs.rs
- A	crates/brush-core-vendored/src/sys/unix/input.rs
- A	crates/brush-core-vendored/src/sys/unix/network.rs
- A	crates/brush-core-vendored/src/sys/unix/resource.rs
- A	crates/brush-core-vendored/src/sys/unix/signal.rs
- A	crates/brush-core-vendored/src/sys/unix/terminal.rs
- A	crates/brush-core-vendored/src/sys/unix/users.rs
- A	crates/brush-core-vendored/src/sys/wasm.rs
- A	crates/brush-core-vendored/src/sys/windows.rs
- A	crates/brush-core-vendored/src/sys/windows/commands.rs
- A	crates/brush-core-vendored/src/sys/windows/fd.rs
- A	crates/brush-core-vendored/src/sys/windows/fs.rs
- A	crates/brush-core-vendored/src/sys/windows/network.rs
- A	crates/brush-core-vendored/src/sys/windows/terminal.rs
- A	crates/brush-core-vendored/src/sys/windows/users.rs
- A	crates/brush-core-vendored/src/terminal.rs
- A	crates/brush-core-vendored/src/tests.rs
- A	crates/brush-core-vendored/src/timing.rs
- A	crates/brush-core-vendored/src/trace_categories.rs
- A	crates/brush-core-vendored/src/traps.rs
- A	crates/brush-core-vendored/src/variables.rs
- A	crates/brush-core-vendored/src/wellknownvars.rs
- A	crates/pi-natives/Cargo.toml
- A	crates/pi-natives/build.rs
- A	crates/pi-natives/src/appearance.rs
- A	crates/pi-natives/src/ast.rs
- A	crates/pi-natives/src/clipboard.rs
- A	crates/pi-natives/src/fd.rs
- A	crates/pi-natives/src/fs_cache.rs
- A	crates/pi-natives/src/glob.rs
- A	crates/pi-natives/src/glob_util.rs
- A	crates/pi-natives/src/grep.rs
- A	crates/pi-natives/src/highlight.rs
- A	crates/pi-natives/src/html.rs
- A	crates/pi-natives/src/image.rs
- A	crates/pi-natives/src/keys.rs
- A	crates/pi-natives/src/lib.rs
- A	crates/pi-natives/src/prof.rs
- A	crates/pi-natives/src/ps.rs
- A	crates/pi-natives/src/pty.rs
- A	crates/pi-natives/src/shell.rs
- A	crates/pi-natives/src/shell/windows.rs
- A	crates/pi-natives/src/task.rs
- A	crates/pi-natives/src/text.rs
- A	crates/pi-natives/src/utils.rs
- A	docs/bash-tool-runtime.md
- A	docs/blob-artifact-architecture.md
- A	docs/compaction.md
- A	docs/config-usage.md
- A	docs/custom-tools.md
- A	docs/environment-variables.md
- A	docs/extension-loading.md
- A	docs/extensions.md
- A	docs/fs-scan-cache-architecture.md
- A	docs/gemini-manifest-extensions.md
- A	docs/handoff-generation-pipeline.md
- A	docs/hooks.md
- A	docs/mcp-protocol-transports.md
- A	docs/mcp-runtime-lifecycle.md
- A	docs/mcp-server-tool-authoring.md
- A	docs/memory.md
- A	docs/models.md
- A	docs/natives-addon-loader-runtime.md
- A	docs/natives-architecture.md
- A	docs/natives-binding-contract.md
- A	docs/natives-build-release-debugging.md
- A	docs/natives-media-system-utils.md
- A	docs/natives-rust-task-cancellation.md
- A	docs/natives-shell-pty-process.md
- A	docs/natives-text-search-pipeline.md
- A	docs/non-compaction-retry-policy.md
- A	docs/notebook-tool-runtime.md
- A	docs/plugin-manager-installer-plumbing.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	docs/porting-from-pi-mono.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	docs/porting-to-natives.md
- A	docs/provider-streaming-internals.md
- A	docs/python-repl.md
- A	docs/resolve-tool-runtime.md
- A	docs/rpc.md
- A	docs/rulebook-matching-pipeline.md
- A	docs/sdk.md
- A	docs/secrets.md
- A	docs/session-operations-export-share-fork-resume.md
- A	docs/session-switching-and-recent-listing.md
- A	docs/session-tree-plan.md
- A	docs/session.md
- A	docs/skills.md
- A	docs/slash-command-internals.md
- A	docs/task-agent-discovery.md
- A	docs/theme.md
- A	docs/tree.md
- A	docs/ttsr-injection-lifecycle.md
- A	docs/tui-runtime-internals.md
- A	docs/tui.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	package.json
- M	packages/agent/CHANGELOG.md
- M	packages/agent/README.md
- M	packages/agent/package.json
- M	packages/agent/src/agent-loop.ts
- M	packages/agent/src/agent.ts
- M	packages/agent/src/proxy.ts
- M	packages/agent/src/types.ts
- M	packages/agent/test/agent-loop.test.ts
- M	packages/agent/test/agent.test.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/agent/test/e2e.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/agent/test/utils/calculate.ts
- M	packages/agent/test/utils/get-current-time.ts
- M	packages/agent/tsconfig.build.json

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/agent/tsconfig.json
- A	packages/agent/tsconfig.publish.json

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/agent/vitest.config.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/CHANGELOG.md
- M	packages/ai/README.md
- M	packages/ai/package.json
- M	packages/ai/scripts/generate-models.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/api-registry.ts
- A	packages/ai/src/auth-storage.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/cli.ts
- M	packages/ai/src/index.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/model-cache.ts
- A	packages/ai/src/model-manager.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/ai/src/models.generated.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/models.json
- A	packages/ai/src/models.json.d.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/models.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/provider-details.ts
- A	packages/ai/src/provider-models/descriptors.ts
- A	packages/ai/src/provider-models/google.ts
- A	packages/ai/src/provider-models/index.ts
- A	packages/ai/src/provider-models/model-policies.ts
- A	packages/ai/src/provider-models/openai-compat.ts
- A	packages/ai/src/provider-models/special.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/providers/amazon-bedrock.ts
- M	packages/ai/src/providers/anthropic.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/providers/azure-openai-responses.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/providers/cursor.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/providers/github-copilot-headers.ts
- A	packages/ai/src/providers/gitlab-duo.ts
- A	packages/ai/src/providers/google-gemini-cli-usage.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/providers/google-gemini-cli.ts
- M	packages/ai/src/providers/google-shared.ts
- M	packages/ai/src/providers/google-vertex.ts
- M	packages/ai/src/providers/google.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/providers/kimi.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/providers/openai-codex-responses.ts
- M	packages/ai/src/providers/openai-codex/constants.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/ai/src/providers/openai-codex/index.ts
- D	packages/ai/src/providers/openai-codex/prompts/codex.ts
- D	packages/ai/src/providers/openai-codex/prompts/system-prompt.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/providers/openai-codex/request-transformer.ts
- M	packages/ai/src/providers/openai-codex/response-handler.ts
- M	packages/ai/src/providers/openai-completions.ts
- M	packages/ai/src/providers/openai-responses.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/providers/synthetic.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/providers/transform-messages.ts
- M	packages/ai/src/stream.ts
- M	packages/ai/src/types.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/usage.ts
- A	packages/ai/src/usage/claude.ts
- A	packages/ai/src/usage/github-copilot.ts
- A	packages/ai/src/usage/google-antigravity.ts
- A	packages/ai/src/usage/kimi.ts
- A	packages/ai/src/usage/minimax-code.ts
- A	packages/ai/src/usage/openai-codex.ts
- A	packages/ai/src/usage/zai.ts
- A	packages/ai/src/utils.ts
- A	packages/ai/src/utils/anthropic-auth.ts
- A	packages/ai/src/utils/discovery/antigravity.ts
- A	packages/ai/src/utils/discovery/codex.ts
- A	packages/ai/src/utils/discovery/cursor.ts
- A	packages/ai/src/utils/discovery/gemini.ts
- A	packages/ai/src/utils/discovery/index.ts
- A	packages/ai/src/utils/discovery/openai-compatible.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/utils/event-stream.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/utils/http-inspector.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/ai/src/utils/migrate-env.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/utils/oauth/anthropic.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/utils/oauth/api-key-validation.ts
- A	packages/ai/src/utils/oauth/callback-server.ts
- A	packages/ai/src/utils/oauth/cerebras.ts
- A	packages/ai/src/utils/oauth/cloudflare-ai-gateway.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/utils/oauth/cursor.ts
- M	packages/ai/src/utils/oauth/github-copilot.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/utils/oauth/gitlab-duo.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/utils/oauth/google-antigravity.ts
- M	packages/ai/src/utils/oauth/google-gemini-cli.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/utils/oauth/huggingface.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/utils/oauth/index.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/utils/oauth/kilo.ts
- A	packages/ai/src/utils/oauth/kimi.ts
- A	packages/ai/src/utils/oauth/litellm.ts
- A	packages/ai/src/utils/oauth/minimax-code.ts
- A	packages/ai/src/utils/oauth/moonshot.ts
- A	packages/ai/src/utils/oauth/nanogpt.ts
- A	packages/ai/src/utils/oauth/nvidia.ts
- A	packages/ai/src/utils/oauth/oauth.html
- A	packages/ai/src/utils/oauth/ollama.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/utils/oauth/openai-codex.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/utils/oauth/opencode.ts
- A	packages/ai/src/utils/oauth/perplexity.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/utils/oauth/pkce.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/utils/oauth/qianfan.ts
- A	packages/ai/src/utils/oauth/qwen-portal.ts
- A	packages/ai/src/utils/oauth/synthetic.ts
- A	packages/ai/src/utils/oauth/together.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/utils/oauth/types.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/utils/oauth/venice.ts
- A	packages/ai/src/utils/oauth/vllm.ts
- A	packages/ai/src/utils/oauth/xiaomi.ts
- A	packages/ai/src/utils/oauth/zai.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/utils/overflow.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/utils/retry.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/ai/src/utils/sanitize-unicode.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/src/utils/schema/CONSTRAINTS.md
- A	packages/ai/src/utils/schema/adapt.ts
- A	packages/ai/src/utils/schema/compatibility.ts
- A	packages/ai/src/utils/schema/equality.ts
- A	packages/ai/src/utils/schema/fields.ts
- A	packages/ai/src/utils/schema/index.ts
- A	packages/ai/src/utils/schema/normalize-cca.ts
- A	packages/ai/src/utils/schema/sanitize-google.ts
- A	packages/ai/src/utils/schema/strict-mode.ts
- A	packages/ai/src/utils/schema/types.ts
- A	packages/ai/src/utils/tool-choice.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/ai/src/utils/typebox-helpers.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/src/utils/validation.ts
- M	packages/ai/test/abort.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/test/anthropic-alignment.test.ts
- A	packages/ai/test/anthropic-oauth.test.ts
- A	packages/ai/test/anthropic-prefill.test.ts
- A	packages/ai/test/anthropic-retry.test.ts
- A	packages/ai/test/api-registry.test.ts
- A	packages/ai/test/auth-storage-codex-selection.test.ts
- A	packages/ai/test/auth-storage-email-dedupe.test.ts
- A	packages/ai/test/callback-server-manual-input.test.ts
- A	packages/ai/test/claude-usage-headers.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/test/context-overflow.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/test/cursor-exec-handlers.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/test/duplicate-tool-results.test.ts
- M	packages/ai/test/empty.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/test/github-copilot-anthropic-auth.test.ts
- A	packages/ai/test/github-copilot-claude-messages-routing.test.ts
- A	packages/ai/test/github-copilot-headers.test.ts
- A	packages/ai/test/github-copilot-model-limits.test.ts
- A	packages/ai/test/gitlab-duo-model-mapping.test.ts
- A	packages/ai/test/google-antigravity-auth.test.ts
- A	packages/ai/test/google-gemini-cli-alignment.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/test/google-thinking-signature.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/test/google-tool-schema.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/test/handoff.test.ts
- M	packages/ai/test/image-limits.test.ts
- M	packages/ai/test/image-tool-result.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/test/kilo-login.test.ts
- A	packages/ai/test/kilo-provider.test.ts
- A	packages/ai/test/nanogpt-login.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/test/oauth.ts
- M	packages/ai/test/openai-codex-include.test.ts
- M	packages/ai/test/openai-codex-stream.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/test/openai-codex-usage-cache.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/test/openai-codex.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/test/openai-completions-tool-result-images.test.ts
- A	packages/ai/test/openai-tool-strict-mode.test.ts
- A	packages/ai/test/schema-compatibility.test.ts
- A	packages/ai/test/schema-helpers.test.ts
- A	packages/ai/test/schema-normalization.test.ts
- A	packages/ai/test/schema-strict-mode.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/ai/test/stream.test.ts
- M	packages/ai/test/tokens.test.ts
- M	packages/ai/test/tool-argument-coercion.test.ts
- M	packages/ai/test/tool-call-without-result.test.ts
- M	packages/ai/test/total-tokens.test.ts
- M	packages/ai/test/unicode-surrogate.test.ts
- M	packages/ai/test/xhigh.test.ts
- M	packages/ai/test/zen.test.ts
- M	packages/ai/tsconfig.build.json

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/ai/tsconfig.json
- A	packages/ai/tsconfig.publish.json

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/ai/vitest.config.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/CHANGELOG.md
- M	packages/coding-agent/DEVELOPMENT.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/MCP_COMMAND_GUIDE.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/README.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/bench/rendering.ts
- A	packages/coding-agent/bunfig.toml

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/docs/compaction.md
- D	packages/coding-agent/docs/config-usage.md
- D	packages/coding-agent/docs/custom-tools.md
- D	packages/coding-agent/docs/extension-loading.md
- D	packages/coding-agent/docs/extensions.md
- D	packages/coding-agent/docs/hooks.md
- D	packages/coding-agent/docs/python-repl.md
- D	packages/coding-agent/docs/rpc.md
- D	packages/coding-agent/docs/sdk.md
- D	packages/coding-agent/docs/session-tree-plan.md
- D	packages/coding-agent/docs/session.md
- D	packages/coding-agent/docs/skills.md
- D	packages/coding-agent/docs/theme.md
- D	packages/coding-agent/docs/tree.md
- D	packages/coding-agent/docs/tui.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/examples/custom-tools/hello/index.ts
- M	packages/coding-agent/examples/custom-tools/todo/index.ts
- M	packages/coding-agent/examples/extensions/api-demo.ts
- M	packages/coding-agent/examples/extensions/chalk-logger.ts
- M	packages/coding-agent/examples/extensions/hello.ts
- M	packages/coding-agent/examples/extensions/pirate.ts
- M	packages/coding-agent/examples/extensions/plan-mode.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/examples/extensions/reload-runtime.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/examples/extensions/todo.ts
- M	packages/coding-agent/examples/extensions/tools.ts
- M	packages/coding-agent/examples/extensions/with-deps/index.ts
- M	packages/coding-agent/examples/extensions/with-deps/package.json
- M	packages/coding-agent/examples/hooks/auto-commit-on-exit.ts
- M	packages/coding-agent/examples/hooks/confirm-destructive.ts
- M	packages/coding-agent/examples/hooks/custom-compaction.ts
- M	packages/coding-agent/examples/hooks/dirty-repo-guard.ts
- M	packages/coding-agent/examples/hooks/file-trigger.ts
- M	packages/coding-agent/examples/hooks/git-checkpoint.ts
- M	packages/coding-agent/examples/hooks/handoff.ts
- M	packages/coding-agent/examples/hooks/permission-gate.ts
- M	packages/coding-agent/examples/hooks/protected-paths.ts
- M	packages/coding-agent/examples/hooks/qna.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/examples/hooks/snake.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/examples/hooks/status-line.ts
- M	packages/coding-agent/examples/sdk/01-minimal.ts
- M	packages/coding-agent/examples/sdk/02-custom-model.ts
- M	packages/coding-agent/examples/sdk/03-custom-prompt.ts
- M	packages/coding-agent/examples/sdk/04-skills.ts
- M	packages/coding-agent/examples/sdk/06-extensions.ts
- M	packages/coding-agent/examples/sdk/06-hooks.ts
- M	packages/coding-agent/examples/sdk/07-context-files.ts
- M	packages/coding-agent/examples/sdk/08-prompt-templates.ts
- M	packages/coding-agent/examples/sdk/08-slash-commands.ts
- M	packages/coding-agent/examples/sdk/09-api-keys-and-oauth.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/examples/sdk/10-settings.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/examples/sdk/11-sessions.ts
- M	packages/coding-agent/examples/sdk/README.md
- M	packages/coding-agent/package.json

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/scripts/format-prompts.ts
- A	packages/coding-agent/scripts/generate-docs-index.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/scripts/generate-template.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/scripts/migrate-sessions.sh

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/async/index.ts
- A	packages/coding-agent/src/async/job-manager.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/capability/context-file.ts
- M	packages/coding-agent/src/capability/extension-module.ts
- M	packages/coding-agent/src/capability/extension.ts
- M	packages/coding-agent/src/capability/fs.ts
- M	packages/coding-agent/src/capability/hook.ts
- M	packages/coding-agent/src/capability/index.ts
- M	packages/coding-agent/src/capability/instruction.ts
- M	packages/coding-agent/src/capability/mcp.ts
- M	packages/coding-agent/src/capability/prompt.ts
- M	packages/coding-agent/src/capability/rule.ts
- M	packages/coding-agent/src/capability/settings.ts
- M	packages/coding-agent/src/capability/skill.ts
- M	packages/coding-agent/src/capability/slash-command.ts
- M	packages/coding-agent/src/capability/ssh.ts
- M	packages/coding-agent/src/capability/system-prompt.ts
- M	packages/coding-agent/src/capability/tool.ts
- M	packages/coding-agent/src/capability/types.ts
- M	packages/coding-agent/src/cli.ts
- M	packages/coding-agent/src/cli/args.ts
- M	packages/coding-agent/src/cli/config-cli.ts
- M	packages/coding-agent/src/cli/file-processor.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/cli/grep-cli.ts
- A	packages/coding-agent/src/cli/jupyter-cli.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/cli/list-models.ts
- M	packages/coding-agent/src/cli/plugin-cli.ts
- M	packages/coding-agent/src/cli/session-picker.ts
- M	packages/coding-agent/src/cli/setup-cli.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/cli/shell-cli.ts
- A	packages/coding-agent/src/cli/ssh-cli.ts
- A	packages/coding-agent/src/cli/stats-cli.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/cli/update-cli.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/cli/web-search-cli.ts
- A	packages/coding-agent/src/commands/commit.ts
- A	packages/coding-agent/src/commands/config.ts
- A	packages/coding-agent/src/commands/grep.ts
- A	packages/coding-agent/src/commands/jupyter.ts
- A	packages/coding-agent/src/commands/launch.ts
- A	packages/coding-agent/src/commands/plugin.ts
- A	packages/coding-agent/src/commands/setup.ts
- A	packages/coding-agent/src/commands/shell.ts
- A	packages/coding-agent/src/commands/ssh.ts
- A	packages/coding-agent/src/commands/stats.ts
- A	packages/coding-agent/src/commands/update.ts
- A	packages/coding-agent/src/commands/web-search.ts
- A	packages/coding-agent/src/commit/agentic/agent.ts
- A	packages/coding-agent/src/commit/agentic/fallback.ts
- A	packages/coding-agent/src/commit/agentic/index.ts
- A	packages/coding-agent/src/commit/agentic/prompts/analyze-file.md
- A	packages/coding-agent/src/commit/agentic/prompts/session-user.md
- A	packages/coding-agent/src/commit/agentic/prompts/split-confirm.md
- A	packages/coding-agent/src/commit/agentic/prompts/system.md
- A	packages/coding-agent/src/commit/agentic/state.ts
- A	packages/coding-agent/src/commit/agentic/tools/analyze-file.ts
- A	packages/coding-agent/src/commit/agentic/tools/git-file-diff.ts
- A	packages/coding-agent/src/commit/agentic/tools/git-hunk.ts
- A	packages/coding-agent/src/commit/agentic/tools/git-overview.ts
- A	packages/coding-agent/src/commit/agentic/tools/index.ts
- A	packages/coding-agent/src/commit/agentic/tools/propose-changelog.ts
- A	packages/coding-agent/src/commit/agentic/tools/propose-commit.ts
- A	packages/coding-agent/src/commit/agentic/tools/recent-commits.ts
- A	packages/coding-agent/src/commit/agentic/tools/schemas.ts
- A	packages/coding-agent/src/commit/agentic/tools/split-commit.ts
- A	packages/coding-agent/src/commit/agentic/topo-sort.ts
- A	packages/coding-agent/src/commit/agentic/trivial.ts
- A	packages/coding-agent/src/commit/agentic/validation.ts
- A	packages/coding-agent/src/commit/analysis/conventional.ts
- A	packages/coding-agent/src/commit/analysis/index.ts
- A	packages/coding-agent/src/commit/analysis/scope.ts
- A	packages/coding-agent/src/commit/analysis/summary.ts
- A	packages/coding-agent/src/commit/analysis/validation.ts
- A	packages/coding-agent/src/commit/changelog/detect.ts
- A	packages/coding-agent/src/commit/changelog/generate.ts
- A	packages/coding-agent/src/commit/changelog/index.ts
- A	packages/coding-agent/src/commit/changelog/parse.ts
- A	packages/coding-agent/src/commit/cli.ts
- A	packages/coding-agent/src/commit/git/diff.ts
- A	packages/coding-agent/src/commit/git/errors.ts
- A	packages/coding-agent/src/commit/git/index.ts
- A	packages/coding-agent/src/commit/git/operations.ts
- A	packages/coding-agent/src/commit/index.ts
- A	packages/coding-agent/src/commit/map-reduce/index.ts
- A	packages/coding-agent/src/commit/map-reduce/map-phase.ts
- A	packages/coding-agent/src/commit/map-reduce/reduce-phase.ts
- A	packages/coding-agent/src/commit/map-reduce/utils.ts
- A	packages/coding-agent/src/commit/message.ts
- A	packages/coding-agent/src/commit/model-selection.ts
- A	packages/coding-agent/src/commit/pipeline.ts
- A	packages/coding-agent/src/commit/prompts/analysis-system.md
- A	packages/coding-agent/src/commit/prompts/analysis-user.md
- A	packages/coding-agent/src/commit/prompts/changelog-system.md
- A	packages/coding-agent/src/commit/prompts/changelog-user.md
- A	packages/coding-agent/src/commit/prompts/file-observer-system.md
- A	packages/coding-agent/src/commit/prompts/file-observer-user.md
- A	packages/coding-agent/src/commit/prompts/reduce-system.md
- A	packages/coding-agent/src/commit/prompts/reduce-user.md
- A	packages/coding-agent/src/commit/prompts/summary-retry.md
- A	packages/coding-agent/src/commit/prompts/summary-system.md
- A	packages/coding-agent/src/commit/prompts/summary-user.md
- A	packages/coding-agent/src/commit/prompts/types-description.md
- A	packages/coding-agent/src/commit/types.ts
- A	packages/coding-agent/src/commit/utils.ts
- A	packages/coding-agent/src/commit/utils/exclusions.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/config.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/config/file-lock.ts

## Fork-renamed files (port = map to upstream layout)
- R079	packages/coding-agent/src/core/keybindings.ts	packages/coding-agent/src/config/keybindings.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/config/model-registry.ts

## Fork-renamed files (port = map to upstream layout)
- R050	packages/coding-agent/src/core/model-resolver.ts	packages/coding-agent/src/config/model-resolver.ts
- R070	packages/coding-agent/src/core/prompt-templates.ts	packages/coding-agent/src/config/prompt-templates.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/config/resolve-config-value.ts
- A	packages/coding-agent/src/config/settings-schema.ts
- A	packages/coding-agent/src/config/settings.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/src/core/agent-session.ts
- D	packages/coding-agent/src/core/agent-storage.ts
- D	packages/coding-agent/src/core/auth-storage.ts
- D	packages/coding-agent/src/core/bash-executor.ts
- D	packages/coding-agent/src/core/custom-commands/bundled/wt/index.ts
- D	packages/coding-agent/src/core/custom-commands/index.ts
- D	packages/coding-agent/src/core/custom-tools/index.ts
- D	packages/coding-agent/src/core/custom-tools/wrapper.ts
- D	packages/coding-agent/src/core/event-bus.ts
- D	packages/coding-agent/src/core/exec.ts
- D	packages/coding-agent/src/core/extensions/index.ts
- D	packages/coding-agent/src/core/file-mentions.ts
- D	packages/coding-agent/src/core/hooks/index.ts
- D	packages/coding-agent/src/core/index.ts
- D	packages/coding-agent/src/core/logger.ts
- D	packages/coding-agent/src/core/mcp/index.ts
- D	packages/coding-agent/src/core/mcp/transports/http.ts
- D	packages/coding-agent/src/core/mcp/transports/index.ts
- D	packages/coding-agent/src/core/mcp/transports/stdio.ts
- D	packages/coding-agent/src/core/model-registry.ts
- D	packages/coding-agent/src/core/plugins/index.ts
- D	packages/coding-agent/src/core/plugins/loader.ts
- D	packages/coding-agent/src/core/plugins/paths.ts
- D	packages/coding-agent/src/core/python-executor.ts
- D	packages/coding-agent/src/core/python-gateway-coordinator.ts
- D	packages/coding-agent/src/core/python-kernel.ts
- D	packages/coding-agent/src/core/python-prelude.ts
- D	packages/coding-agent/src/core/sdk.ts
- D	packages/coding-agent/src/core/settings-manager.ts
- D	packages/coding-agent/src/core/skills.ts
- D	packages/coding-agent/src/core/slash-commands.ts
- D	packages/coding-agent/src/core/ssh-executor.ts
- D	packages/coding-agent/src/core/storage-migration.ts
- D	packages/coding-agent/src/core/streaming-output.ts
- D	packages/coding-agent/src/core/system-prompt.ts
- D	packages/coding-agent/src/core/terminal-notify.ts
- D	packages/coding-agent/src/core/timings.ts
- D	packages/coding-agent/src/core/tools/bash.ts
- D	packages/coding-agent/src/core/tools/complete.ts
- D	packages/coding-agent/src/core/tools/exa/company.ts
- D	packages/coding-agent/src/core/tools/exa/linkedin.ts
- D	packages/coding-agent/src/core/tools/exa/researcher.ts
- D	packages/coding-agent/src/core/tools/exa/search.ts
- D	packages/coding-agent/src/core/tools/find.ts
- D	packages/coding-agent/src/core/tools/git.ts
- D	packages/coding-agent/src/core/tools/grep.ts
- D	packages/coding-agent/src/core/tools/index.ts
- D	packages/coding-agent/src/core/tools/ls.ts
- D	packages/coding-agent/src/core/tools/lsp/rust-analyzer.ts
- D	packages/coding-agent/src/core/tools/output.ts
- D	packages/coding-agent/src/core/tools/patch/index.ts
- D	packages/coding-agent/src/core/tools/patch/normative.ts
- D	packages/coding-agent/src/core/tools/patch/shared.ts
- D	packages/coding-agent/src/core/tools/path-utils.ts
- D	packages/coding-agent/src/core/tools/python.ts
- D	packages/coding-agent/src/core/tools/read.ts
- D	packages/coding-agent/src/core/tools/ssh.ts
- D	packages/coding-agent/src/core/tools/task/artifacts.ts
- D	packages/coding-agent/src/core/tools/task/discovery.ts
- D	packages/coding-agent/src/core/tools/task/executor.ts
- D	packages/coding-agent/src/core/tools/task/index.ts
- D	packages/coding-agent/src/core/tools/task/model-resolver.ts
- D	packages/coding-agent/src/core/tools/task/render.ts
- D	packages/coding-agent/src/core/tools/task/worker-protocol.ts
- D	packages/coding-agent/src/core/tools/task/worker.ts
- D	packages/coding-agent/src/core/tools/todo-write.ts
- D	packages/coding-agent/src/core/tools/truncate.ts
- D	packages/coding-agent/src/core/tools/web-scrapers/hackage.ts
- D	packages/coding-agent/src/core/tools/web-scrapers/utils.ts
- D	packages/coding-agent/src/core/tools/web-search/auth.ts
- D	packages/coding-agent/src/core/tools/web-search/providers/exa.ts
- D	packages/coding-agent/src/core/tools/web-search/providers/perplexity.ts
- D	packages/coding-agent/src/core/tools/web-search/render.ts
- D	packages/coding-agent/src/core/tools/web-search/types.ts
- D	packages/coding-agent/src/core/tools/write.ts
- D	packages/coding-agent/src/core/ttsr.ts
- D	packages/coding-agent/src/core/utils.ts
- D	packages/coding-agent/src/core/voice-controller.ts
- D	packages/coding-agent/src/core/voice-supervisor.ts
- D	packages/coding-agent/src/core/voice.ts

## Fork-renamed files (port = map to upstream layout)
- R089	packages/coding-agent/src/core/cursor/exec-bridge.ts	packages/coding-agent/src/cursor.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/debug/index.ts
- A	packages/coding-agent/src/debug/log-formatting.ts
- A	packages/coding-agent/src/debug/log-viewer.ts
- A	packages/coding-agent/src/debug/profiler.ts
- A	packages/coding-agent/src/debug/report-bundle.ts
- A	packages/coding-agent/src/debug/system-info.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/discovery/agents-md.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/discovery/agents.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/discovery/builtin.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/discovery/claude-plugins.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/discovery/claude.ts
- M	packages/coding-agent/src/discovery/cline.ts
- M	packages/coding-agent/src/discovery/codex.ts
- M	packages/coding-agent/src/discovery/cursor.ts
- M	packages/coding-agent/src/discovery/gemini.ts
- M	packages/coding-agent/src/discovery/github.ts
- M	packages/coding-agent/src/discovery/helpers.ts
- M	packages/coding-agent/src/discovery/index.ts
- M	packages/coding-agent/src/discovery/mcp-json.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/discovery/opencode.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/discovery/ssh.ts
- M	packages/coding-agent/src/discovery/vscode.ts
- M	packages/coding-agent/src/discovery/windsurf.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/exa/company.ts
- A	packages/coding-agent/src/exa/factory.ts

## Fork-renamed files (port = map to upstream layout)
- R059	packages/coding-agent/src/core/tools/exa/index.ts	packages/coding-agent/src/exa/index.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/exa/linkedin.ts

## Fork-renamed files (port = map to upstream layout)
- R061	packages/coding-agent/src/core/tools/exa/mcp-client.ts	packages/coding-agent/src/exa/mcp-client.ts
- R086	packages/coding-agent/src/core/tools/exa/render.ts	packages/coding-agent/src/exa/render.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/exa/researcher.ts
- A	packages/coding-agent/src/exa/search.ts

## Fork-renamed files (port = map to upstream layout)
- R097	packages/coding-agent/src/core/tools/exa/types.ts	packages/coding-agent/src/exa/types.ts
- R097	packages/coding-agent/src/core/tools/exa/websets.ts	packages/coding-agent/src/exa/websets.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/exec/bash-executor.ts
- A	packages/coding-agent/src/exec/exec.ts
- A	packages/coding-agent/src/exec/non-interactive-env.ts

## Fork-renamed files (port = map to upstream layout)
- R087	packages/coding-agent/src/core/custom-share.ts	packages/coding-agent/src/export/custom-share.ts
- R076	packages/coding-agent/src/core/export-html/index.ts	packages/coding-agent/src/export/html/index.ts
- R098	packages/coding-agent/src/core/export-html/template.css	packages/coding-agent/src/export/html/template.css

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/export/html/template.generated.ts

## Fork-renamed files (port = map to upstream layout)
- R100	packages/coding-agent/src/core/export-html/template.html	packages/coding-agent/src/export/html/template.html
- R095	packages/coding-agent/src/core/export-html/template.js	packages/coding-agent/src/export/html/template.js
- R100	packages/coding-agent/src/core/export-html/template.macro.ts	packages/coding-agent/src/export/html/template.macro.ts
- R100	packages/coding-agent/src/core/export-html/vendor/highlight.min.js	packages/coding-agent/src/export/html/vendor/highlight.min.js
- R100	packages/coding-agent/src/core/export-html/vendor/marked.min.js	packages/coding-agent/src/export/html/vendor/marked.min.js

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/export/ttsr.ts

## Fork-renamed files (port = map to upstream layout)
- R097	packages/coding-agent/src/core/custom-commands/bundled/review/index.ts	packages/coding-agent/src/extensibility/custom-commands/bundled/review/index.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/extensibility/custom-commands/index.ts

## Fork-renamed files (port = map to upstream layout)
- R083	packages/coding-agent/src/core/custom-commands/loader.ts	packages/coding-agent/src/extensibility/custom-commands/loader.ts
- R098	packages/coding-agent/src/core/custom-commands/types.ts	packages/coding-agent/src/extensibility/custom-commands/types.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/extensibility/custom-tools/index.ts

## Fork-renamed files (port = map to upstream layout)
- R070	packages/coding-agent/src/core/custom-tools/loader.ts	packages/coding-agent/src/extensibility/custom-tools/loader.ts
- R067	packages/coding-agent/src/core/custom-tools/types.ts	packages/coding-agent/src/extensibility/custom-tools/types.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/extensibility/custom-tools/wrapper.ts
- A	packages/coding-agent/src/extensibility/extensions/index.ts

## Fork-renamed files (port = map to upstream layout)
- R073	packages/coding-agent/src/core/extensions/loader.ts	packages/coding-agent/src/extensibility/extensions/loader.ts
- R054	packages/coding-agent/src/core/extensions/runner.ts	packages/coding-agent/src/extensibility/extensions/runner.ts
- R062	packages/coding-agent/src/core/extensions/types.ts	packages/coding-agent/src/extensibility/extensions/types.ts
- R058	packages/coding-agent/src/core/extensions/wrapper.ts	packages/coding-agent/src/extensibility/extensions/wrapper.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/extensibility/hooks/index.ts

## Fork-renamed files (port = map to upstream layout)
- R090	packages/coding-agent/src/core/hooks/loader.ts	packages/coding-agent/src/extensibility/hooks/loader.ts
- R073	packages/coding-agent/src/core/hooks/runner.ts	packages/coding-agent/src/extensibility/hooks/runner.ts
- R068	packages/coding-agent/src/core/hooks/tool-wrapper.ts	packages/coding-agent/src/extensibility/hooks/tool-wrapper.ts
- R087	packages/coding-agent/src/core/hooks/types.ts	packages/coding-agent/src/extensibility/hooks/types.ts
- R084	packages/coding-agent/src/core/plugins/doctor.ts	packages/coding-agent/src/extensibility/plugins/doctor.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/extensibility/plugins/git-url.ts
- A	packages/coding-agent/src/extensibility/plugins/index.ts

## Fork-renamed files (port = map to upstream layout)
- R064	packages/coding-agent/src/core/plugins/installer.ts	packages/coding-agent/src/extensibility/plugins/installer.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/extensibility/plugins/loader.ts

## Fork-renamed files (port = map to upstream layout)
- R057	packages/coding-agent/src/core/plugins/manager.ts	packages/coding-agent/src/extensibility/plugins/manager.ts
- R099	packages/coding-agent/src/core/plugins/parser.ts	packages/coding-agent/src/extensibility/plugins/parser.ts
- R100	packages/coding-agent/src/core/plugins/types.ts	packages/coding-agent/src/extensibility/plugins/types.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/extensibility/skills.ts
- A	packages/coding-agent/src/extensibility/slash-commands.ts
- A	packages/coding-agent/src/extensibility/tool-proxy.ts
- A	packages/coding-agent/src/extensibility/utils.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/index.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/internal-urls/agent-protocol.ts
- A	packages/coding-agent/src/internal-urls/artifact-protocol.ts
- A	packages/coding-agent/src/internal-urls/index.ts
- A	packages/coding-agent/src/internal-urls/jobs-protocol.ts
- A	packages/coding-agent/src/internal-urls/json-query.ts
- A	packages/coding-agent/src/internal-urls/local-protocol.ts
- A	packages/coding-agent/src/internal-urls/memory-protocol.ts
- A	packages/coding-agent/src/internal-urls/pi-protocol.ts
- A	packages/coding-agent/src/internal-urls/router.ts
- A	packages/coding-agent/src/internal-urls/rule-protocol.ts
- A	packages/coding-agent/src/internal-urls/skill-protocol.ts
- A	packages/coding-agent/src/internal-urls/types.ts
- A	packages/coding-agent/src/ipy/executor.ts
- A	packages/coding-agent/src/ipy/gateway-coordinator.ts
- A	packages/coding-agent/src/ipy/kernel.ts

## Fork-renamed files (port = map to upstream layout)
- R070	packages/coding-agent/src/core/python-modules.ts	packages/coding-agent/src/ipy/modules.ts
- R067	packages/coding-agent/src/core/python-prelude.py	packages/coding-agent/src/ipy/prelude.py

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/ipy/prelude.ts
- A	packages/coding-agent/src/ipy/runtime.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/src/lib/worktree/collapse.ts
- D	packages/coding-agent/src/lib/worktree/constants.ts
- D	packages/coding-agent/src/lib/worktree/errors.ts
- D	packages/coding-agent/src/lib/worktree/git.ts
- D	packages/coding-agent/src/lib/worktree/index.ts
- D	packages/coding-agent/src/lib/worktree/operations.ts
- D	packages/coding-agent/src/lib/worktree/session.ts
- D	packages/coding-agent/src/lib/worktree/stats.ts

## Fork-renamed files (port = map to upstream layout)
- R081	packages/coding-agent/src/core/tools/lsp/client.ts	packages/coding-agent/src/lsp/client.ts
- R094	packages/coding-agent/src/core/tools/lsp/clients/biome-client.ts	packages/coding-agent/src/lsp/clients/biome-client.ts
- R091	packages/coding-agent/src/core/tools/lsp/clients/index.ts	packages/coding-agent/src/lsp/clients/index.ts
- R075	packages/coding-agent/src/core/tools/lsp/clients/lsp-linter-client.ts	packages/coding-agent/src/lsp/clients/lsp-linter-client.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/lsp/clients/swiftlint-client.ts

## Fork-renamed files (port = map to upstream layout)
- R086	packages/coding-agent/src/core/tools/lsp/config.ts	packages/coding-agent/src/lsp/config.ts
- R096	packages/coding-agent/src/core/tools/lsp/defaults.json	packages/coding-agent/src/lsp/defaults.json
- R094	packages/coding-agent/src/core/tools/lsp/edits.ts	packages/coding-agent/src/lsp/edits.ts
- R057	packages/coding-agent/src/core/tools/lsp/index.ts	packages/coding-agent/src/lsp/index.ts
- R086	packages/coding-agent/src/core/tools/lsp/lspmux.ts	packages/coding-agent/src/lsp/lspmux.ts
- R064	packages/coding-agent/src/core/tools/lsp/render.ts	packages/coding-agent/src/lsp/render.ts
- R077	packages/coding-agent/src/core/tools/lsp/types.ts	packages/coding-agent/src/lsp/types.ts
- R064	packages/coding-agent/src/core/tools/lsp/utils.ts	packages/coding-agent/src/lsp/utils.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/main.ts

## Fork-renamed files (port = map to upstream layout)
- R076	packages/coding-agent/src/core/mcp/client.ts	packages/coding-agent/src/mcp/client.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/mcp/config-writer.ts

## Fork-renamed files (port = map to upstream layout)
- R058	packages/coding-agent/src/core/mcp/config.ts	packages/coding-agent/src/mcp/config.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/mcp/index.ts

## Fork-renamed files (port = map to upstream layout)
- R094	packages/coding-agent/src/core/mcp/json-rpc.ts	packages/coding-agent/src/mcp/json-rpc.ts
- R076	packages/coding-agent/src/core/mcp/loader.ts	packages/coding-agent/src/mcp/loader.ts
- R055	packages/coding-agent/src/core/mcp/manager.ts	packages/coding-agent/src/mcp/manager.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/mcp/oauth-discovery.ts
- A	packages/coding-agent/src/mcp/oauth-flow.ts
- A	packages/coding-agent/src/mcp/render.ts

## Fork-renamed files (port = map to upstream layout)
- R051	packages/coding-agent/src/core/mcp/tool-bridge.ts	packages/coding-agent/src/mcp/tool-bridge.ts
- R091	packages/coding-agent/src/core/mcp/tool-cache.ts	packages/coding-agent/src/mcp/tool-cache.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/mcp/transports/http.ts
- A	packages/coding-agent/src/mcp/transports/index.ts
- A	packages/coding-agent/src/mcp/transports/stdio.ts

## Fork-renamed files (port = map to upstream layout)
- R088	packages/coding-agent/src/core/mcp/types.ts	packages/coding-agent/src/mcp/types.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/memories/index.ts
- A	packages/coding-agent/src/memories/storage.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/src/migrations.ts
- D	packages/coding-agent/src/modes/cleanup.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/components/agent-dashboard.ts
- A	packages/coding-agent/src/modes/components/assistant-message.ts
- A	packages/coding-agent/src/modes/components/bash-execution.ts

## Fork-renamed files (port = map to upstream layout)
- R069	packages/coding-agent/src/modes/interactive/components/bordered-loader.ts	packages/coding-agent/src/modes/components/bordered-loader.ts
- R065	packages/coding-agent/src/modes/interactive/components/branch-summary-message.ts	packages/coding-agent/src/modes/components/branch-summary-message.ts
- R064	packages/coding-agent/src/modes/interactive/components/compaction-summary-message.ts	packages/coding-agent/src/modes/components/compaction-summary-message.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/components/countdown-timer.ts

## Fork-renamed files (port = map to upstream layout)
- R074	packages/coding-agent/src/modes/interactive/components/custom-editor.ts	packages/coding-agent/src/modes/components/custom-editor.ts
- R053	packages/coding-agent/src/modes/interactive/components/custom-message.ts	packages/coding-agent/src/modes/components/custom-message.ts
- R053	packages/coding-agent/src/modes/interactive/components/diff.ts	packages/coding-agent/src/modes/components/diff.ts
- R066	packages/coding-agent/src/modes/interactive/components/dynamic-border.ts	packages/coding-agent/src/modes/components/dynamic-border.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/components/extensions/extension-dashboard.ts

## Fork-renamed files (port = map to upstream layout)
- R062	packages/coding-agent/src/modes/interactive/components/extensions/extension-list.ts	packages/coding-agent/src/modes/components/extensions/extension-list.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/components/extensions/index.ts

## Fork-renamed files (port = map to upstream layout)
- R078	packages/coding-agent/src/modes/interactive/components/extensions/inspector-panel.ts	packages/coding-agent/src/modes/components/extensions/inspector-panel.ts
- R090	packages/coding-agent/src/modes/interactive/components/extensions/state-manager.ts	packages/coding-agent/src/modes/components/extensions/state-manager.ts
- R098	packages/coding-agent/src/modes/interactive/components/extensions/types.ts	packages/coding-agent/src/modes/components/extensions/types.ts
- R051	packages/coding-agent/src/modes/interactive/components/footer.ts	packages/coding-agent/src/modes/components/footer.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/components/history-search.ts
- A	packages/coding-agent/src/modes/components/hook-editor.ts

## Fork-renamed files (port = map to upstream layout)
- R060	packages/coding-agent/src/modes/interactive/components/hook-input.ts	packages/coding-agent/src/modes/components/hook-input.ts
- R057	packages/coding-agent/src/modes/interactive/components/hook-message.ts	packages/coding-agent/src/modes/components/hook-message.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/components/hook-selector.ts
- A	packages/coding-agent/src/modes/components/index.ts

## Fork-renamed files (port = map to upstream layout)
- R094	packages/coding-agent/src/modes/interactive/components/keybinding-hints.ts	packages/coding-agent/src/modes/components/keybinding-hints.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/components/login-dialog.ts
- A	packages/coding-agent/src/modes/components/mcp-add-wizard.ts
- A	packages/coding-agent/src/modes/components/model-selector.ts
- A	packages/coding-agent/src/modes/components/oauth-selector.ts

## Fork-renamed files (port = map to upstream layout)
- R075	packages/coding-agent/src/modes/interactive/components/plugin-settings.ts	packages/coding-agent/src/modes/components/plugin-settings.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/components/python-execution.ts

## Fork-renamed files (port = map to upstream layout)
- R069	packages/coding-agent/src/modes/interactive/components/queue-mode-selector.ts	packages/coding-agent/src/modes/components/queue-mode-selector.ts
- R067	packages/coding-agent/src/modes/interactive/components/read-tool-group.ts	packages/coding-agent/src/modes/components/read-tool-group.ts
- R064	packages/coding-agent/src/modes/interactive/components/session-selector.ts	packages/coding-agent/src/modes/components/session-selector.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/components/settings-defs.ts
- A	packages/coding-agent/src/modes/components/settings-selector.ts

## Fork-renamed files (port = map to upstream layout)
- R070	packages/coding-agent/src/modes/interactive/components/show-images-selector.ts	packages/coding-agent/src/modes/components/show-images-selector.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/components/skill-message.ts

## Fork-renamed files (port = map to upstream layout)
- R062	packages/coding-agent/src/modes/interactive/components/status-line-segment-editor.ts	packages/coding-agent/src/modes/components/status-line-segment-editor.ts
- R052	packages/coding-agent/src/modes/interactive/components/status-line.ts	packages/coding-agent/src/modes/components/status-line.ts
- R100	packages/coding-agent/src/modes/interactive/components/status-line/index.ts	packages/coding-agent/src/modes/components/status-line/index.ts
- R083	packages/coding-agent/src/modes/interactive/components/status-line/presets.ts	packages/coding-agent/src/modes/components/status-line/presets.ts
- R087	packages/coding-agent/src/modes/interactive/components/status-line/segments.ts	packages/coding-agent/src/modes/components/status-line/segments.ts
- R096	packages/coding-agent/src/modes/interactive/components/status-line/separators.ts	packages/coding-agent/src/modes/components/status-line/separators.ts
- R089	packages/coding-agent/src/modes/interactive/components/status-line/types.ts	packages/coding-agent/src/modes/components/status-line/types.ts
- R052	packages/coding-agent/src/modes/interactive/components/theme-selector.ts	packages/coding-agent/src/modes/components/theme-selector.ts
- R068	packages/coding-agent/src/modes/interactive/components/thinking-selector.ts	packages/coding-agent/src/modes/components/thinking-selector.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/components/todo-reminder.ts
- A	packages/coding-agent/src/modes/components/tool-execution.ts

## Fork-renamed files (port = map to upstream layout)
- R069	packages/coding-agent/src/modes/interactive/components/tree-selector.ts	packages/coding-agent/src/modes/components/tree-selector.ts
- R057	packages/coding-agent/src/modes/interactive/components/ttsr-notification.ts	packages/coding-agent/src/modes/components/ttsr-notification.ts
- R074	packages/coding-agent/src/modes/interactive/components/user-message-selector.ts	packages/coding-agent/src/modes/components/user-message-selector.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/components/user-message.ts

## Fork-renamed files (port = map to upstream layout)
- R083	packages/coding-agent/src/modes/interactive/components/visual-truncate.ts	packages/coding-agent/src/modes/components/visual-truncate.ts
- R062	packages/coding-agent/src/modes/interactive/components/welcome.ts	packages/coding-agent/src/modes/components/welcome.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/controllers/command-controller.ts
- A	packages/coding-agent/src/modes/controllers/event-controller.ts

## Fork-renamed files (port = map to upstream layout)
- R068	packages/coding-agent/src/modes/interactive/controllers/extension-ui-controller.ts	packages/coding-agent/src/modes/controllers/extension-ui-controller.ts
- R063	packages/coding-agent/src/modes/interactive/controllers/input-controller.ts	packages/coding-agent/src/modes/controllers/input-controller.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/controllers/mcp-command-controller.ts

## Fork-renamed files (port = map to upstream layout)
- R062	packages/coding-agent/src/modes/interactive/controllers/selector-controller.ts	packages/coding-agent/src/modes/controllers/selector-controller.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/controllers/ssh-command-controller.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/modes/index.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/interactive-mode.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/src/modes/interactive/components/armin.ts
- D	packages/coding-agent/src/modes/interactive/components/assistant-message.ts
- D	packages/coding-agent/src/modes/interactive/components/bash-execution.ts
- D	packages/coding-agent/src/modes/interactive/components/countdown-timer.ts
- D	packages/coding-agent/src/modes/interactive/components/extensions/extension-dashboard.ts
- D	packages/coding-agent/src/modes/interactive/components/extensions/index.ts
- D	packages/coding-agent/src/modes/interactive/components/history-search.ts
- D	packages/coding-agent/src/modes/interactive/components/hook-editor.ts
- D	packages/coding-agent/src/modes/interactive/components/hook-selector.ts
- D	packages/coding-agent/src/modes/interactive/components/index.ts
- D	packages/coding-agent/src/modes/interactive/components/login-dialog.ts
- D	packages/coding-agent/src/modes/interactive/components/model-selector.ts
- D	packages/coding-agent/src/modes/interactive/components/oauth-selector.ts
- D	packages/coding-agent/src/modes/interactive/components/settings-defs.ts
- D	packages/coding-agent/src/modes/interactive/components/settings-selector.ts
- D	packages/coding-agent/src/modes/interactive/components/todo-display.ts
- D	packages/coding-agent/src/modes/interactive/components/todo-reminder.ts
- D	packages/coding-agent/src/modes/interactive/components/tool-execution.ts
- D	packages/coding-agent/src/modes/interactive/components/user-message.ts
- D	packages/coding-agent/src/modes/interactive/controllers/command-controller.ts
- D	packages/coding-agent/src/modes/interactive/controllers/event-controller.ts
- D	packages/coding-agent/src/modes/interactive/interactive-mode.ts
- D	packages/coding-agent/src/modes/interactive/theme/defaults/basalt.json
- D	packages/coding-agent/src/modes/interactive/theme/defaults/obsidian.json
- D	packages/coding-agent/src/modes/interactive/theme/defaults/onyx.json
- D	packages/coding-agent/src/modes/interactive/theme/defaults/porcelain.json
- D	packages/coding-agent/src/modes/interactive/theme/defaults/titanium.json
- D	packages/coding-agent/src/modes/interactive/utils/voice-manager.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/oauth-manual-input.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/modes/print-mode.ts
- M	packages/coding-agent/src/modes/rpc/rpc-client.ts
- M	packages/coding-agent/src/modes/rpc/rpc-mode.ts
- M	packages/coding-agent/src/modes/rpc/rpc-types.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/shared.ts

## Fork-renamed files (port = map to upstream layout)
- R097	packages/coding-agent/src/modes/interactive/theme/dark.json	packages/coding-agent/src/modes/theme/dark.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/alabaster.json	packages/coding-agent/src/modes/theme/defaults/alabaster.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/amethyst.json	packages/coding-agent/src/modes/theme/defaults/amethyst.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/anthracite.json	packages/coding-agent/src/modes/theme/defaults/anthracite.json

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/theme/defaults/basalt.json

## Fork-renamed files (port = map to upstream layout)
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/birch.json	packages/coding-agent/src/modes/theme/defaults/birch.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-abyss.json	packages/coding-agent/src/modes/theme/defaults/dark-abyss.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-arctic.json	packages/coding-agent/src/modes/theme/defaults/dark-arctic.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-aurora.json	packages/coding-agent/src/modes/theme/defaults/dark-aurora.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-catppuccin.json	packages/coding-agent/src/modes/theme/defaults/dark-catppuccin.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-cavern.json	packages/coding-agent/src/modes/theme/defaults/dark-cavern.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-copper.json	packages/coding-agent/src/modes/theme/defaults/dark-copper.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-cosmos.json	packages/coding-agent/src/modes/theme/defaults/dark-cosmos.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-cyberpunk.json	packages/coding-agent/src/modes/theme/defaults/dark-cyberpunk.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-dracula.json	packages/coding-agent/src/modes/theme/defaults/dark-dracula.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-eclipse.json	packages/coding-agent/src/modes/theme/defaults/dark-eclipse.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-ember.json	packages/coding-agent/src/modes/theme/defaults/dark-ember.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-equinox.json	packages/coding-agent/src/modes/theme/defaults/dark-equinox.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-forest.json	packages/coding-agent/src/modes/theme/defaults/dark-forest.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-github.json	packages/coding-agent/src/modes/theme/defaults/dark-github.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-gruvbox.json	packages/coding-agent/src/modes/theme/defaults/dark-gruvbox.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-lavender.json	packages/coding-agent/src/modes/theme/defaults/dark-lavender.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-lunar.json	packages/coding-agent/src/modes/theme/defaults/dark-lunar.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-midnight.json	packages/coding-agent/src/modes/theme/defaults/dark-midnight.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-monochrome.json	packages/coding-agent/src/modes/theme/defaults/dark-monochrome.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-monokai.json	packages/coding-agent/src/modes/theme/defaults/dark-monokai.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-nebula.json	packages/coding-agent/src/modes/theme/defaults/dark-nebula.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-nord.json	packages/coding-agent/src/modes/theme/defaults/dark-nord.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-ocean.json	packages/coding-agent/src/modes/theme/defaults/dark-ocean.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-one.json	packages/coding-agent/src/modes/theme/defaults/dark-one.json

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/theme/defaults/dark-poimandres.json

## Fork-renamed files (port = map to upstream layout)
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-rainforest.json	packages/coding-agent/src/modes/theme/defaults/dark-rainforest.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-reef.json	packages/coding-agent/src/modes/theme/defaults/dark-reef.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-retro.json	packages/coding-agent/src/modes/theme/defaults/dark-retro.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-rose-pine.json	packages/coding-agent/src/modes/theme/defaults/dark-rose-pine.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-sakura.json	packages/coding-agent/src/modes/theme/defaults/dark-sakura.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-slate.json	packages/coding-agent/src/modes/theme/defaults/dark-slate.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-solarized.json	packages/coding-agent/src/modes/theme/defaults/dark-solarized.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-solstice.json	packages/coding-agent/src/modes/theme/defaults/dark-solstice.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-starfall.json	packages/coding-agent/src/modes/theme/defaults/dark-starfall.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-sunset.json	packages/coding-agent/src/modes/theme/defaults/dark-sunset.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-swamp.json	packages/coding-agent/src/modes/theme/defaults/dark-swamp.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-synthwave.json	packages/coding-agent/src/modes/theme/defaults/dark-synthwave.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-taiga.json	packages/coding-agent/src/modes/theme/defaults/dark-taiga.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-terminal.json	packages/coding-agent/src/modes/theme/defaults/dark-terminal.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-tokyo-night.json	packages/coding-agent/src/modes/theme/defaults/dark-tokyo-night.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-tundra.json	packages/coding-agent/src/modes/theme/defaults/dark-tundra.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-twilight.json	packages/coding-agent/src/modes/theme/defaults/dark-twilight.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/dark-volcanic.json	packages/coding-agent/src/modes/theme/defaults/dark-volcanic.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/graphite.json	packages/coding-agent/src/modes/theme/defaults/graphite.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/index.ts	packages/coding-agent/src/modes/theme/defaults/index.ts
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-arctic.json	packages/coding-agent/src/modes/theme/defaults/light-arctic.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-aurora-day.json	packages/coding-agent/src/modes/theme/defaults/light-aurora-day.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-canyon.json	packages/coding-agent/src/modes/theme/defaults/light-canyon.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-catppuccin.json	packages/coding-agent/src/modes/theme/defaults/light-catppuccin.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-cirrus.json	packages/coding-agent/src/modes/theme/defaults/light-cirrus.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-coral.json	packages/coding-agent/src/modes/theme/defaults/light-coral.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-cyberpunk.json	packages/coding-agent/src/modes/theme/defaults/light-cyberpunk.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-dawn.json	packages/coding-agent/src/modes/theme/defaults/light-dawn.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-dunes.json	packages/coding-agent/src/modes/theme/defaults/light-dunes.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-eucalyptus.json	packages/coding-agent/src/modes/theme/defaults/light-eucalyptus.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-forest.json	packages/coding-agent/src/modes/theme/defaults/light-forest.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-frost.json	packages/coding-agent/src/modes/theme/defaults/light-frost.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-github.json	packages/coding-agent/src/modes/theme/defaults/light-github.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-glacier.json	packages/coding-agent/src/modes/theme/defaults/light-glacier.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-gruvbox.json	packages/coding-agent/src/modes/theme/defaults/light-gruvbox.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-haze.json	packages/coding-agent/src/modes/theme/defaults/light-haze.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-honeycomb.json	packages/coding-agent/src/modes/theme/defaults/light-honeycomb.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-lagoon.json	packages/coding-agent/src/modes/theme/defaults/light-lagoon.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-lavender.json	packages/coding-agent/src/modes/theme/defaults/light-lavender.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-meadow.json	packages/coding-agent/src/modes/theme/defaults/light-meadow.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-mint.json	packages/coding-agent/src/modes/theme/defaults/light-mint.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-monochrome.json	packages/coding-agent/src/modes/theme/defaults/light-monochrome.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-ocean.json	packages/coding-agent/src/modes/theme/defaults/light-ocean.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-one.json	packages/coding-agent/src/modes/theme/defaults/light-one.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-opal.json	packages/coding-agent/src/modes/theme/defaults/light-opal.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-orchard.json	packages/coding-agent/src/modes/theme/defaults/light-orchard.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-paper.json	packages/coding-agent/src/modes/theme/defaults/light-paper.json

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/theme/defaults/light-poimandres.json

## Fork-renamed files (port = map to upstream layout)
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-prism.json	packages/coding-agent/src/modes/theme/defaults/light-prism.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-retro.json	packages/coding-agent/src/modes/theme/defaults/light-retro.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-sand.json	packages/coding-agent/src/modes/theme/defaults/light-sand.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-savanna.json	packages/coding-agent/src/modes/theme/defaults/light-savanna.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-solarized.json	packages/coding-agent/src/modes/theme/defaults/light-solarized.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-soleil.json	packages/coding-agent/src/modes/theme/defaults/light-soleil.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-sunset.json	packages/coding-agent/src/modes/theme/defaults/light-sunset.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-synthwave.json	packages/coding-agent/src/modes/theme/defaults/light-synthwave.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-tokyo-night.json	packages/coding-agent/src/modes/theme/defaults/light-tokyo-night.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-wetland.json	packages/coding-agent/src/modes/theme/defaults/light-wetland.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/light-zenith.json	packages/coding-agent/src/modes/theme/defaults/light-zenith.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/limestone.json	packages/coding-agent/src/modes/theme/defaults/limestone.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/mahogany.json	packages/coding-agent/src/modes/theme/defaults/mahogany.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/marble.json	packages/coding-agent/src/modes/theme/defaults/marble.json

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/theme/defaults/obsidian.json
- A	packages/coding-agent/src/modes/theme/defaults/onyx.json

## Fork-renamed files (port = map to upstream layout)
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/pearl.json	packages/coding-agent/src/modes/theme/defaults/pearl.json

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/theme/defaults/porcelain.json

## Fork-renamed files (port = map to upstream layout)
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/quartz.json	packages/coding-agent/src/modes/theme/defaults/quartz.json
- R097	packages/coding-agent/src/modes/interactive/theme/defaults/sandstone.json	packages/coding-agent/src/modes/theme/defaults/sandstone.json

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/theme/defaults/titanium.json

## Fork-renamed files (port = map to upstream layout)
- R097	packages/coding-agent/src/modes/interactive/theme/light.json	packages/coding-agent/src/modes/theme/light.json

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/modes/theme/mermaid-cache.ts

## Fork-renamed files (port = map to upstream layout)
- R098	packages/coding-agent/src/modes/interactive/theme/theme-schema.json	packages/coding-agent/src/modes/theme/theme-schema.json
- R065	packages/coding-agent/src/modes/interactive/theme/theme.ts	packages/coding-agent/src/modes/theme/theme.ts
- R071	packages/coding-agent/src/modes/interactive/types.ts	packages/coding-agent/src/modes/types.ts
- R066	packages/coding-agent/src/modes/interactive/utils/ui-helpers.ts	packages/coding-agent/src/modes/utils/ui-helpers.ts
- R063	packages/coding-agent/src/core/tools/patch/applicator.ts	packages/coding-agent/src/patch/applicator.ts
- R074	packages/coding-agent/src/core/tools/patch/diff.ts	packages/coding-agent/src/patch/diff.ts
- R075	packages/coding-agent/src/core/tools/patch/fuzzy.ts	packages/coding-agent/src/patch/fuzzy.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/patch/hashline.ts
- A	packages/coding-agent/src/patch/index.ts

## Fork-renamed files (port = map to upstream layout)
- R050	packages/coding-agent/src/core/tools/patch/normalize.ts	packages/coding-agent/src/patch/normalize.ts
- R096	packages/coding-agent/src/core/tools/patch/parser.ts	packages/coding-agent/src/patch/parser.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/patch/shared.ts

## Fork-renamed files (port = map to upstream layout)
- R083	packages/coding-agent/src/core/tools/patch/types.ts	packages/coding-agent/src/patch/types.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/plan-mode/approved-plan.ts
- A	packages/coding-agent/src/plan-mode/state.ts
- A	packages/coding-agent/src/priority.json
- A	packages/coding-agent/src/prompts/agents/designer.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/agents/explore.md
- M	packages/coding-agent/src/prompts/agents/frontmatter.md
- M	packages/coding-agent/src/prompts/agents/init.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/prompts/agents/librarian.md
- A	packages/coding-agent/src/prompts/agents/oracle.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/agents/plan.md
- M	packages/coding-agent/src/prompts/agents/reviewer.md
- M	packages/coding-agent/src/prompts/agents/task.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/prompts/compaction/branch-summary-context.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/compaction/branch-summary-preamble.md
- M	packages/coding-agent/src/prompts/compaction/branch-summary.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/prompts/compaction/compaction-short-summary.md
- A	packages/coding-agent/src/prompts/compaction/compaction-summary-context.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/compaction/compaction-summary.md
- M	packages/coding-agent/src/prompts/compaction/compaction-turn-prefix.md
- M	packages/coding-agent/src/prompts/compaction/compaction-update-summary.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/prompts/memories/consolidation.md
- A	packages/coding-agent/src/prompts/memories/read-path.md
- A	packages/coding-agent/src/prompts/memories/stage_one_input.md
- A	packages/coding-agent/src/prompts/memories/stage_one_system.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/review-request.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/prompts/system/agent-creation-architect.md
- A	packages/coding-agent/src/prompts/system/agent-creation-user.md
- A	packages/coding-agent/src/prompts/system/commit-message-system.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/system/custom-system-prompt.md
- M	packages/coding-agent/src/prompts/system/file-operations.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/prompts/system/plan-mode-active.md
- A	packages/coding-agent/src/prompts/system/plan-mode-approved.md
- A	packages/coding-agent/src/prompts/system/plan-mode-reference.md
- A	packages/coding-agent/src/prompts/system/plan-mode-subagent.md
- A	packages/coding-agent/src/prompts/system/subagent-submit-reminder.md
- A	packages/coding-agent/src/prompts/system/subagent-system-prompt.md
- A	packages/coding-agent/src/prompts/system/subagent-user-prompt.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/system/summarization-system.md
- M	packages/coding-agent/src/prompts/system/system-prompt.md
- M	packages/coding-agent/src/prompts/system/title-system.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/prompts/system/ttsr-interrupt.md
- A	packages/coding-agent/src/prompts/system/web-search.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/tools/ask.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/prompts/tools/ast-edit.md
- A	packages/coding-agent/src/prompts/tools/ast-grep.md
- A	packages/coding-agent/src/prompts/tools/async-result.md
- A	packages/coding-agent/src/prompts/tools/await.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/tools/bash.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/prompts/tools/browser.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/tools/calculator.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/prompts/tools/cancel-job.md
- A	packages/coding-agent/src/prompts/tools/checkpoint.md
- A	packages/coding-agent/src/prompts/tools/exit-plan-mode.md
- A	packages/coding-agent/src/prompts/tools/fetch.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/tools/find.md
- M	packages/coding-agent/src/prompts/tools/gemini-image.md

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/src/prompts/tools/git.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/tools/grep.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/prompts/tools/hashline.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/tools/lsp.md

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/src/prompts/tools/output.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/tools/patch.md
- M	packages/coding-agent/src/prompts/tools/python.md
- M	packages/coding-agent/src/prompts/tools/read.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/prompts/tools/render-mermaid.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/tools/replace.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/prompts/tools/resolve.md
- A	packages/coding-agent/src/prompts/tools/rewind.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/tools/ssh.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/prompts/tools/task-summary.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/tools/task.md
- M	packages/coding-agent/src/prompts/tools/todo-write.md

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/src/prompts/tools/web-fetch.md

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/prompts/tools/web-search.md
- M	packages/coding-agent/src/prompts/tools/write.md

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/src/prompts/voice-summary.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/sdk.ts
- A	packages/coding-agent/src/secrets/index.ts
- A	packages/coding-agent/src/secrets/obfuscator.ts
- A	packages/coding-agent/src/secrets/regex.ts
- A	packages/coding-agent/src/session/agent-session.ts
- A	packages/coding-agent/src/session/agent-storage.ts
- A	packages/coding-agent/src/session/artifacts.ts
- A	packages/coding-agent/src/session/auth-storage.ts
- A	packages/coding-agent/src/session/blob-store.ts

## Fork-renamed files (port = map to upstream layout)
- R095	packages/coding-agent/src/core/compaction/branch-summarization.ts	packages/coding-agent/src/session/compaction/branch-summarization.ts
- R075	packages/coding-agent/src/core/compaction/compaction.ts	packages/coding-agent/src/session/compaction/compaction.ts
- R100	packages/coding-agent/src/core/compaction/index.ts	packages/coding-agent/src/session/compaction/index.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/session/compaction/pruning.ts

## Fork-renamed files (port = map to upstream layout)
- R077	packages/coding-agent/src/core/compaction/utils.ts	packages/coding-agent/src/session/compaction/utils.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/session/exit-diagnostics.ts

## Fork-renamed files (port = map to upstream layout)
- R052	packages/coding-agent/src/core/history-storage.ts	packages/coding-agent/src/session/history-storage.ts
- R056	packages/coding-agent/src/core/messages.ts	packages/coding-agent/src/session/messages.ts
- R052	packages/coding-agent/src/core/session-manager.ts	packages/coding-agent/src/session/session-manager.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/session/session-sentinel-protocol.ts
- A	packages/coding-agent/src/session/session-sentinel.ts

## Fork-renamed files (port = map to upstream layout)
- R053	packages/coding-agent/src/core/session-storage.ts	packages/coding-agent/src/session/session-storage.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/session/streaming-output.ts
- A	packages/coding-agent/src/slash-commands/builtin-registry.ts
- A	packages/coding-agent/src/ssh/config-writer.ts

## Fork-renamed files (port = map to upstream layout)
- R071	packages/coding-agent/src/core/ssh/connection-manager.ts	packages/coding-agent/src/ssh/connection-manager.ts
- R053	packages/coding-agent/src/core/ssh/ssh-executor.ts	packages/coding-agent/src/ssh/ssh-executor.ts
- R053	packages/coding-agent/src/core/ssh/sshfs-mount.ts	packages/coding-agent/src/ssh/sshfs-mount.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/ssh/utils.ts
- A	packages/coding-agent/src/stt/downloader.ts
- A	packages/coding-agent/src/stt/index.ts
- A	packages/coding-agent/src/stt/recorder.ts
- A	packages/coding-agent/src/stt/setup.ts
- A	packages/coding-agent/src/stt/stt-controller.ts
- A	packages/coding-agent/src/stt/transcribe.py
- A	packages/coding-agent/src/stt/transcriber.ts
- A	packages/coding-agent/src/system-prompt.ts

## Fork-renamed files (port = map to upstream layout)
- R051	packages/coding-agent/src/core/tools/task/agents.ts	packages/coding-agent/src/task/agents.ts
- R089	packages/coding-agent/src/core/tools/task/commands.ts	packages/coding-agent/src/task/commands.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/task/discovery.ts
- A	packages/coding-agent/src/task/executor.ts
- A	packages/coding-agent/src/task/index.ts

## Fork-renamed files (port = map to upstream layout)
- R100	packages/coding-agent/src/core/tools/task/name-generator.ts	packages/coding-agent/src/task/name-generator.ts
- R087	packages/coding-agent/src/core/tools/task/omp-command.ts	packages/coding-agent/src/task/omp-command.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/task/output-manager.ts

## Fork-renamed files (port = map to upstream layout)
- R074	packages/coding-agent/src/core/tools/task/parallel.ts	packages/coding-agent/src/task/parallel.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/task/render.ts

## Fork-renamed files (port = map to upstream layout)
- R087	packages/coding-agent/src/core/tools/task/subprocess-tool-registry.ts	packages/coding-agent/src/task/subprocess-tool-registry.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/task/template.ts

## Fork-renamed files (port = map to upstream layout)
- R051	packages/coding-agent/src/core/tools/task/types.ts	packages/coding-agent/src/task/types.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/task/worktree.ts

## Fork-renamed files (port = map to upstream layout)
- R055	packages/coding-agent/src/core/tools/ask.ts	packages/coding-agent/src/tools/ask.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/tools/ast-edit.ts
- A	packages/coding-agent/src/tools/ast-grep.ts
- A	packages/coding-agent/src/tools/await-tool.ts
- A	packages/coding-agent/src/tools/bash-interactive.ts

## Fork-renamed files (port = map to upstream layout)
- R057	packages/coding-agent/src/core/tools/bash-interceptor.ts	packages/coding-agent/src/tools/bash-interceptor.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/tools/bash-normalize.ts
- A	packages/coding-agent/src/tools/bash-skill-urls.ts
- A	packages/coding-agent/src/tools/bash.ts
- A	packages/coding-agent/src/tools/browser.ts

## Fork-renamed files (port = map to upstream layout)
- R069	packages/coding-agent/src/core/tools/calculator.ts	packages/coding-agent/src/tools/calculator.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/tools/cancel-job.ts
- A	packages/coding-agent/src/tools/checkpoint.ts

## Fork-renamed files (port = map to upstream layout)
- R061	packages/coding-agent/src/core/tools/context.ts	packages/coding-agent/src/tools/context.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/tools/exit-plan-mode.ts

## Fork-renamed files (port = map to upstream layout)
- R062	packages/coding-agent/src/core/tools/web-fetch.ts	packages/coding-agent/src/tools/fetch.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/tools/find.ts
- A	packages/coding-agent/src/tools/fs-cache-invalidation.ts

## Fork-renamed files (port = map to upstream layout)
- R050	packages/coding-agent/src/core/tools/gemini-image.ts	packages/coding-agent/src/tools/gemini-image.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/tools/grep.ts
- A	packages/coding-agent/src/tools/index.ts
- A	packages/coding-agent/src/tools/json-tree.ts

## Fork-renamed files (port = map to upstream layout)
- R070	packages/coding-agent/src/core/tools/jtd-to-json-schema.ts	packages/coding-agent/src/tools/jtd-to-json-schema.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/tools/jtd-to-typescript.ts
- A	packages/coding-agent/src/tools/jtd-utils.ts
- A	packages/coding-agent/src/tools/list-limit.ts

## Fork-renamed files (port = map to upstream layout)
- R063	packages/coding-agent/src/core/tools/notebook.ts	packages/coding-agent/src/tools/notebook.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/tools/output-meta.ts
- A	packages/coding-agent/src/tools/path-utils.ts
- A	packages/coding-agent/src/tools/pending-action.ts
- A	packages/coding-agent/src/tools/plan-mode-guard.ts
- A	packages/coding-agent/src/tools/puppeteer/00_stealth_tampering.txt
- A	packages/coding-agent/src/tools/puppeteer/01_stealth_activity.txt
- A	packages/coding-agent/src/tools/puppeteer/02_stealth_hairline.txt
- A	packages/coding-agent/src/tools/puppeteer/03_stealth_botd.txt
- A	packages/coding-agent/src/tools/puppeteer/04_stealth_iframe.txt
- A	packages/coding-agent/src/tools/puppeteer/05_stealth_webgl.txt
- A	packages/coding-agent/src/tools/puppeteer/06_stealth_screen.txt
- A	packages/coding-agent/src/tools/puppeteer/07_stealth_fonts.txt
- A	packages/coding-agent/src/tools/puppeteer/08_stealth_audio.txt
- A	packages/coding-agent/src/tools/puppeteer/09_stealth_locale.txt
- A	packages/coding-agent/src/tools/puppeteer/10_stealth_plugins.txt
- A	packages/coding-agent/src/tools/puppeteer/11_stealth_hardware.txt
- A	packages/coding-agent/src/tools/puppeteer/12_stealth_codecs.txt
- A	packages/coding-agent/src/tools/puppeteer/13_stealth_worker.txt
- A	packages/coding-agent/src/tools/python.ts
- A	packages/coding-agent/src/tools/read.ts
- A	packages/coding-agent/src/tools/render-mermaid.ts

## Fork-renamed files (port = map to upstream layout)
- R067	packages/coding-agent/src/core/tools/render-utils.ts	packages/coding-agent/src/tools/render-utils.ts
- R068	packages/coding-agent/src/core/tools/renderers.ts	packages/coding-agent/src/tools/renderers.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/tools/resolve.ts

## Fork-renamed files (port = map to upstream layout)
- R075	packages/coding-agent/src/core/tools/review.ts	packages/coding-agent/src/tools/review.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/tools/ssh.ts
- A	packages/coding-agent/src/tools/submit-result.ts
- A	packages/coding-agent/src/tools/todo-write.ts
- A	packages/coding-agent/src/tools/tool-errors.ts
- A	packages/coding-agent/src/tools/tool-result.ts
- A	packages/coding-agent/src/tools/tool-timeouts.ts
- A	packages/coding-agent/src/tools/write.ts
- A	packages/coding-agent/src/tui/code-cell.ts
- A	packages/coding-agent/src/tui/file-list.ts
- A	packages/coding-agent/src/tui/index.ts
- A	packages/coding-agent/src/tui/output-block.ts
- A	packages/coding-agent/src/tui/status-line.ts
- A	packages/coding-agent/src/tui/tree-list.ts
- A	packages/coding-agent/src/tui/types.ts
- A	packages/coding-agent/src/tui/utils.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/utils/changelog.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/src/utils/clipboard.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/utils/command-args.ts
- A	packages/coding-agent/src/utils/commit-message-generator.ts
- A	packages/coding-agent/src/utils/event-bus.ts
- A	packages/coding-agent/src/utils/external-editor.ts
- A	packages/coding-agent/src/utils/file-display-mode.ts
- A	packages/coding-agent/src/utils/file-mentions.ts

## Fork-renamed files (port = map to upstream layout)
- R079	packages/coding-agent/src/core/frontmatter.ts	packages/coding-agent/src/utils/frontmatter.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/utils/fuzzy.ts
- M	packages/coding-agent/src/utils/image-convert.ts
- M	packages/coding-agent/src/utils/image-resize.ts
- M	packages/coding-agent/src/utils/mime.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/utils/open.ts
- A	packages/coding-agent/src/utils/prompt-format.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/utils/shell-snapshot.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/src/utils/shell.ts

## Fork-renamed files (port = map to upstream layout)
- R075	packages/coding-agent/src/core/title-generator.ts	packages/coding-agent/src/utils/title-generator.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/src/utils/tools-manager.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/src/vendor/photon/LICENSE.md
- D	packages/coding-agent/src/vendor/photon/README.md
- D	packages/coding-agent/src/vendor/photon/index.d.ts
- D	packages/coding-agent/src/vendor/photon/index.js
- D	packages/coding-agent/src/vendor/photon/photon_rs_bg.wasm
- D	packages/coding-agent/src/vendor/photon/photon_rs_bg.wasm.d.ts

## Fork-renamed files (port = map to upstream layout)
- R090	packages/coding-agent/src/core/tools/web-scrapers/artifacthub.ts	packages/coding-agent/src/web/scrapers/artifacthub.ts
- R072	packages/coding-agent/src/core/tools/web-scrapers/arxiv.ts	packages/coding-agent/src/web/scrapers/arxiv.ts
- R082	packages/coding-agent/src/core/tools/web-scrapers/aur.ts	packages/coding-agent/src/web/scrapers/aur.ts
- R091	packages/coding-agent/src/core/tools/web-scrapers/biorxiv.ts	packages/coding-agent/src/web/scrapers/biorxiv.ts
- R082	packages/coding-agent/src/core/tools/web-scrapers/bluesky.ts	packages/coding-agent/src/web/scrapers/bluesky.ts
- R092	packages/coding-agent/src/core/tools/web-scrapers/brew.ts	packages/coding-agent/src/web/scrapers/brew.ts
- R086	packages/coding-agent/src/core/tools/web-scrapers/cheatsh.ts	packages/coding-agent/src/web/scrapers/cheatsh.ts
- R051	packages/coding-agent/src/core/tools/web-scrapers/chocolatey.ts	packages/coding-agent/src/web/scrapers/chocolatey.ts
- R080	packages/coding-agent/src/core/tools/web-scrapers/choosealicense.ts	packages/coding-agent/src/web/scrapers/choosealicense.ts
- R080	packages/coding-agent/src/core/tools/web-scrapers/cisa-kev.ts	packages/coding-agent/src/web/scrapers/cisa-kev.ts
- R082	packages/coding-agent/src/core/tools/web-scrapers/clojars.ts	packages/coding-agent/src/web/scrapers/clojars.ts
- R076	packages/coding-agent/src/core/tools/web-scrapers/coingecko.ts	packages/coding-agent/src/web/scrapers/coingecko.ts
- R079	packages/coding-agent/src/core/tools/web-scrapers/crates-io.ts	packages/coding-agent/src/web/scrapers/crates-io.ts
- R086	packages/coding-agent/src/core/tools/web-scrapers/crossref.ts	packages/coding-agent/src/web/scrapers/crossref.ts
- R071	packages/coding-agent/src/core/tools/web-scrapers/devto.ts	packages/coding-agent/src/web/scrapers/devto.ts
- R095	packages/coding-agent/src/core/tools/web-scrapers/discogs.ts	packages/coding-agent/src/web/scrapers/discogs.ts
- R086	packages/coding-agent/src/core/tools/web-scrapers/discourse.ts	packages/coding-agent/src/web/scrapers/discourse.ts
- R071	packages/coding-agent/src/core/tools/web-scrapers/dockerhub.ts	packages/coding-agent/src/web/scrapers/dockerhub.ts
- R076	packages/coding-agent/src/core/tools/web-scrapers/fdroid.ts	packages/coding-agent/src/web/scrapers/fdroid.ts
- R078	packages/coding-agent/src/core/tools/web-scrapers/firefox-addons.ts	packages/coding-agent/src/web/scrapers/firefox-addons.ts
- R087	packages/coding-agent/src/core/tools/web-scrapers/flathub.ts	packages/coding-agent/src/web/scrapers/flathub.ts
- R085	packages/coding-agent/src/core/tools/web-scrapers/github-gist.ts	packages/coding-agent/src/web/scrapers/github-gist.ts
- R081	packages/coding-agent/src/core/tools/web-scrapers/github.ts	packages/coding-agent/src/web/scrapers/github.ts
- R051	packages/coding-agent/src/core/tools/web-scrapers/gitlab.ts	packages/coding-agent/src/web/scrapers/gitlab.ts
- R089	packages/coding-agent/src/core/tools/web-scrapers/go-pkg.ts	packages/coding-agent/src/web/scrapers/go-pkg.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/web/scrapers/hackage.ts

## Fork-renamed files (port = map to upstream layout)
- R079	packages/coding-agent/src/core/tools/web-scrapers/hackernews.ts	packages/coding-agent/src/web/scrapers/hackernews.ts
- R066	packages/coding-agent/src/core/tools/web-scrapers/hex.ts	packages/coding-agent/src/web/scrapers/hex.ts
- R077	packages/coding-agent/src/core/tools/web-scrapers/huggingface.ts	packages/coding-agent/src/web/scrapers/huggingface.ts
- R071	packages/coding-agent/src/core/tools/web-scrapers/iacr.ts	packages/coding-agent/src/web/scrapers/iacr.ts
- R099	packages/coding-agent/src/core/tools/web-scrapers/index.ts	packages/coding-agent/src/web/scrapers/index.ts
- R084	packages/coding-agent/src/core/tools/web-scrapers/jetbrains-marketplace.ts	packages/coding-agent/src/web/scrapers/jetbrains-marketplace.ts
- R086	packages/coding-agent/src/core/tools/web-scrapers/lemmy.ts	packages/coding-agent/src/web/scrapers/lemmy.ts
- R080	packages/coding-agent/src/core/tools/web-scrapers/lobsters.ts	packages/coding-agent/src/web/scrapers/lobsters.ts
- R080	packages/coding-agent/src/core/tools/web-scrapers/mastodon.ts	packages/coding-agent/src/web/scrapers/mastodon.ts
- R083	packages/coding-agent/src/core/tools/web-scrapers/maven.ts	packages/coding-agent/src/web/scrapers/maven.ts
- R087	packages/coding-agent/src/core/tools/web-scrapers/mdn.ts	packages/coding-agent/src/web/scrapers/mdn.ts
- R084	packages/coding-agent/src/core/tools/web-scrapers/metacpan.ts	packages/coding-agent/src/web/scrapers/metacpan.ts
- R088	packages/coding-agent/src/core/tools/web-scrapers/musicbrainz.ts	packages/coding-agent/src/web/scrapers/musicbrainz.ts
- R080	packages/coding-agent/src/core/tools/web-scrapers/npm.ts	packages/coding-agent/src/web/scrapers/npm.ts
- R078	packages/coding-agent/src/core/tools/web-scrapers/nuget.ts	packages/coding-agent/src/web/scrapers/nuget.ts
- R085	packages/coding-agent/src/core/tools/web-scrapers/nvd.ts	packages/coding-agent/src/web/scrapers/nvd.ts
- R079	packages/coding-agent/src/core/tools/web-scrapers/ollama.ts	packages/coding-agent/src/web/scrapers/ollama.ts
- R086	packages/coding-agent/src/core/tools/web-scrapers/open-vsx.ts	packages/coding-agent/src/web/scrapers/open-vsx.ts
- R082	packages/coding-agent/src/core/tools/web-scrapers/opencorporates.ts	packages/coding-agent/src/web/scrapers/opencorporates.ts
- R074	packages/coding-agent/src/core/tools/web-scrapers/openlibrary.ts	packages/coding-agent/src/web/scrapers/openlibrary.ts
- R094	packages/coding-agent/src/core/tools/web-scrapers/orcid.ts	packages/coding-agent/src/web/scrapers/orcid.ts
- R082	packages/coding-agent/src/core/tools/web-scrapers/osv.ts	packages/coding-agent/src/web/scrapers/osv.ts
- R084	packages/coding-agent/src/core/tools/web-scrapers/packagist.ts	packages/coding-agent/src/web/scrapers/packagist.ts
- R069	packages/coding-agent/src/core/tools/web-scrapers/pub-dev.ts	packages/coding-agent/src/web/scrapers/pub-dev.ts
- R069	packages/coding-agent/src/core/tools/web-scrapers/pubmed.ts	packages/coding-agent/src/web/scrapers/pubmed.ts
- R079	packages/coding-agent/src/core/tools/web-scrapers/pypi.ts	packages/coding-agent/src/web/scrapers/pypi.ts
- R080	packages/coding-agent/src/core/tools/web-scrapers/rawg.ts	packages/coding-agent/src/web/scrapers/rawg.ts
- R089	packages/coding-agent/src/core/tools/web-scrapers/readthedocs.ts	packages/coding-agent/src/web/scrapers/readthedocs.ts
- R083	packages/coding-agent/src/core/tools/web-scrapers/reddit.ts	packages/coding-agent/src/web/scrapers/reddit.ts
- R090	packages/coding-agent/src/core/tools/web-scrapers/repology.ts	packages/coding-agent/src/web/scrapers/repology.ts
- R090	packages/coding-agent/src/core/tools/web-scrapers/rfc.ts	packages/coding-agent/src/web/scrapers/rfc.ts
- R081	packages/coding-agent/src/core/tools/web-scrapers/rubygems.ts	packages/coding-agent/src/web/scrapers/rubygems.ts
- R083	packages/coding-agent/src/core/tools/web-scrapers/searchcode.ts	packages/coding-agent/src/web/scrapers/searchcode.ts
- R094	packages/coding-agent/src/core/tools/web-scrapers/sec-edgar.ts	packages/coding-agent/src/web/scrapers/sec-edgar.ts
- R080	packages/coding-agent/src/core/tools/web-scrapers/semantic-scholar.ts	packages/coding-agent/src/web/scrapers/semantic-scholar.ts
- R088	packages/coding-agent/src/core/tools/web-scrapers/snapcraft.ts	packages/coding-agent/src/web/scrapers/snapcraft.ts
- R088	packages/coding-agent/src/core/tools/web-scrapers/sourcegraph.ts	packages/coding-agent/src/web/scrapers/sourcegraph.ts
- R082	packages/coding-agent/src/core/tools/web-scrapers/spdx.ts	packages/coding-agent/src/web/scrapers/spdx.ts
- R090	packages/coding-agent/src/core/tools/web-scrapers/spotify.ts	packages/coding-agent/src/web/scrapers/spotify.ts
- R084	packages/coding-agent/src/core/tools/web-scrapers/stackoverflow.ts	packages/coding-agent/src/web/scrapers/stackoverflow.ts
- R089	packages/coding-agent/src/core/tools/web-scrapers/terraform.ts	packages/coding-agent/src/web/scrapers/terraform.ts
- R084	packages/coding-agent/src/core/tools/web-scrapers/tldr.ts	packages/coding-agent/src/web/scrapers/tldr.ts
- R068	packages/coding-agent/src/core/tools/web-scrapers/twitter.ts	packages/coding-agent/src/web/scrapers/twitter.ts
- R056	packages/coding-agent/src/core/tools/web-scrapers/types.ts	packages/coding-agent/src/web/scrapers/types.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/web/scrapers/utils.ts

## Fork-renamed files (port = map to upstream layout)
- R076	packages/coding-agent/src/core/tools/web-scrapers/vimeo.ts	packages/coding-agent/src/web/scrapers/vimeo.ts
- R090	packages/coding-agent/src/core/tools/web-scrapers/vscode-marketplace.ts	packages/coding-agent/src/web/scrapers/vscode-marketplace.ts
- R090	packages/coding-agent/src/core/tools/web-scrapers/w3c.ts	packages/coding-agent/src/web/scrapers/w3c.ts
- R092	packages/coding-agent/src/core/tools/web-scrapers/wikidata.ts	packages/coding-agent/src/web/scrapers/wikidata.ts
- R081	packages/coding-agent/src/core/tools/web-scrapers/wikipedia.ts	packages/coding-agent/src/web/scrapers/wikipedia.ts
- R064	packages/coding-agent/src/core/tools/web-scrapers/youtube.ts	packages/coding-agent/src/web/scrapers/youtube.ts
- R061	packages/coding-agent/src/core/tools/web-search/index.ts	packages/coding-agent/src/web/search/index.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/web/search/provider.ts

## Fork-renamed files (port = map to upstream layout)
- R072	packages/coding-agent/src/core/tools/web-search/providers/anthropic.ts	packages/coding-agent/src/web/search/providers/anthropic.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/src/web/search/providers/base.ts
- A	packages/coding-agent/src/web/search/providers/brave.ts
- A	packages/coding-agent/src/web/search/providers/codex.ts
- A	packages/coding-agent/src/web/search/providers/exa.ts
- A	packages/coding-agent/src/web/search/providers/gemini.ts
- A	packages/coding-agent/src/web/search/providers/jina.ts
- A	packages/coding-agent/src/web/search/providers/kimi.ts
- A	packages/coding-agent/src/web/search/providers/perplexity.ts
- A	packages/coding-agent/src/web/search/providers/synthetic.ts
- A	packages/coding-agent/src/web/search/providers/utils.ts
- A	packages/coding-agent/src/web/search/providers/zai.ts
- A	packages/coding-agent/src/web/search/render.ts
- A	packages/coding-agent/src/web/search/types.ts
- A	packages/coding-agent/src/web/search/utils.ts
- A	packages/coding-agent/test/agent-session-auto-compaction-queue.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/agent-session-branching.test.ts
- M	packages/coding-agent/test/agent-session-compaction.test.ts
- M	packages/coding-agent/test/agent-session-concurrent.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/agent-session-context-promotion.test.ts
- A	packages/coding-agent/test/agent-session-handoff.test.ts
- A	packages/coding-agent/test/agent-session-new-session-todos.test.ts
- A	packages/coding-agent/test/agent-session-resolve-reminder.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/agent-session-tree-navigation.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/agent-session-user-shortcut-hooks.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/args.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/async-job-manager.test.ts
- A	packages/coding-agent/test/auth-storage-minimax-login.test.ts
- A	packages/coding-agent/test/auth-storage-rotation.test.ts
- A	packages/coding-agent/test/autocomplete-max-visible.test.ts
- A	packages/coding-agent/test/bash-executor.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/block-images.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/checkpoint-rpc-qa.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/compaction-hooks-example.test.ts
- M	packages/coding-agent/test/compaction-hooks.test.ts
- M	packages/coding-agent/test/compaction-thinking-model.test.ts
- M	packages/coding-agent/test/compaction.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/config-cli.test.ts
- A	packages/coding-agent/test/config-spacing.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/core/apply-patch-adverserial.test.ts
- M	packages/coding-agent/test/core/apply-patch-regression.test.ts
- M	packages/coding-agent/test/core/apply-patch.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/core/hashline.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/core/python-executor-display.test.ts
- M	packages/coding-agent/test/core/python-executor-lifecycle.test.ts
- M	packages/coding-agent/test/core/python-executor-mapping.test.ts
- M	packages/coding-agent/test/core/python-executor-per-call.test.ts
- M	packages/coding-agent/test/core/python-executor-session.test.ts
- M	packages/coding-agent/test/core/python-executor-streaming.test.ts
- M	packages/coding-agent/test/core/python-executor-timeout.test.ts
- M	packages/coding-agent/test/core/python-executor.lifecycle.test.ts
- M	packages/coding-agent/test/core/python-executor.result.test.ts
- M	packages/coding-agent/test/core/python-executor.test.ts
- M	packages/coding-agent/test/core/python-kernel-display.test.ts
- M	packages/coding-agent/test/core/python-kernel-env.test.ts
- M	packages/coding-agent/test/core/python-kernel-session.test.ts
- M	packages/coding-agent/test/core/python-kernel-ws.test.ts
- M	packages/coding-agent/test/core/python-kernel.lifecycle.test.ts
- M	packages/coding-agent/test/core/python-kernel.test.ts
- M	packages/coding-agent/test/core/python-modules.test.ts
- M	packages/coding-agent/test/core/python-prelude.test.ts
- M	packages/coding-agent/test/core/settings-manager-python.test.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/test/core/streaming-output.test.ts
- D	packages/coding-agent/test/core/system-prompt.python.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/debug/log-formatting.test.ts
- A	packages/coding-agent/test/debug/log-viewer.test.ts
- A	packages/coding-agent/test/discovery/agent-fields.test.ts
- A	packages/coding-agent/test/discovery/claude-plugins.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/discovery/helpers.test.ts
- M	packages/coding-agent/test/edit-diff.test.ts
- M	packages/coding-agent/test/extensions-discovery.test.ts
- M	packages/coding-agent/test/extensions-runner.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/file-mentions.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/fixtures/large-session.jsonl
- M	packages/coding-agent/test/fuzzy.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/git-url.test.ts
- A	packages/coding-agent/test/image-b64poly.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/interactive-mode-status.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/internal-urls/local-protocol.test.ts
- A	packages/coding-agent/test/internal-urls/memory-protocol.test.ts
- A	packages/coding-agent/test/memories-runtime.test.ts
- A	packages/coding-agent/test/memories-storage.test.ts
- A	packages/coding-agent/test/memories/instructions.test.ts
- A	packages/coding-agent/test/model-registry-runtime-provider.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/model-registry.test.ts
- M	packages/coding-agent/test/model-resolver.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/oauth-manual-input.test.ts
- A	packages/coding-agent/test/plan-mode/approved-plan.test.ts
- A	packages/coding-agent/test/plan-mode/plan-mode-approved-prompt.test.ts
- A	packages/coding-agent/test/prompt-format.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/prompt-templates.test.ts
- M	packages/coding-agent/test/python-tool-settings.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/rpc-client.start.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/rpc-example.ts
- M	packages/coding-agent/test/rpc.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/sdk-model-selection.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/sdk-skills.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/secrets-obfuscator.test.ts
- A	packages/coding-agent/test/session-exit-diagnostics.test.ts
- A	packages/coding-agent/test/session-liveness.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/session-manager/build-context.test.ts
- M	packages/coding-agent/test/session-manager/file-operations.test.ts
- M	packages/coding-agent/test/session-manager/labels.test.ts
- M	packages/coding-agent/test/session-manager/migration.test.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/test/session-manager/rewrite-tool-call.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/session-manager/save-entry.test.ts
- M	packages/coding-agent/test/session-manager/tree-traversal.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/session-provider-section.test.ts
- A	packages/coding-agent/test/session-sentinel.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/settings-manager.test.ts
- M	packages/coding-agent/test/skills.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/slash-commands/login.test.ts
- A	packages/coding-agent/test/ssh/connection-manager.test.ts
- A	packages/coding-agent/test/streaming-edit-abort.test.ts
- A	packages/coding-agent/test/streaming-output.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/streaming-render-debug.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/system-prompt-templates.test.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/test/system-prompt.test.ts
- D	packages/coding-agent/test/task-model-resolver.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/task/agents-blocking.test.ts
- A	packages/coding-agent/test/task/executor-subagent-reminders.test.ts
- A	packages/coding-agent/test/task/executor-warnings.test.ts
- A	packages/coding-agent/test/task/render-report-finding.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/test-theme-colors.ts
- M	packages/coding-agent/test/tools.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/tools/ast-edit.test.ts
- A	packages/coding-agent/test/tools/bash-normalize.test.ts
- A	packages/coding-agent/test/tools/bash-skill-urls.test.ts
- A	packages/coding-agent/test/tools/exit-plan-mode.test.ts
- A	packages/coding-agent/test/tools/grep-internal-urls.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/tools/index.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/tools/jtd-to-json-schema.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/tools/lsp-batching.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/tools/lsp-regressions.test.ts
- A	packages/coding-agent/test/tools/plan-mode-guard-local.test.ts
- A	packages/coding-agent/test/tools/provider-schema-compatibility.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/tools/python-execution.test.ts
- M	packages/coding-agent/test/tools/python-fallback.test.ts
- M	packages/coding-agent/test/tools/python-renderer.test.ts
- M	packages/coding-agent/test/tools/python-tool-mode.test.ts
- M	packages/coding-agent/test/tools/python.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/tools/resolve.test.ts
- A	packages/coding-agent/test/tools/review.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/tools/schema-validation.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/tools/submit-result-extraction.test.ts
- A	packages/coding-agent/test/tools/submit-result.test.ts
- A	packages/coding-agent/test/tools/task-template.test.ts
- A	packages/coding-agent/test/tools/todo-write.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/tools/web-scrapers/academic.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/business.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/dev-platforms.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/documentation.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/finance-media.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/git-hosting.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/media.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/package-managers-2.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/package-managers.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/package-registries.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/research.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/security.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/social-extended.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/social.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/stackexchange.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/standards.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/wikipedia.test.ts
- M	packages/coding-agent/test/tools/web-scrapers/youtube.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/tools/web-search-anthropic.test.ts
- A	packages/coding-agent/test/tools/web-search-exa.test.ts
- A	packages/coding-agent/test/tools/web-search-gemini.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/truncate-to-width.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/ttsr.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/test/utilities.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/test/utils/filter-user-extensions.ts
- A	packages/coding-agent/test/visual-truncate.test.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/coding-agent/test/worktree/collapse.test.ts
- D	packages/coding-agent/test/worktree/operations.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/coding-agent/tsconfig.build.json
- M	packages/coding-agent/tsconfig.check.json
- M	packages/coding-agent/tsconfig.examples.json
- M	packages/coding-agent/tsconfig.json

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/coding-agent/tsconfig.publish.json

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/git-tool/CHANGELOG.md
- D	packages/git-tool/package.json
- D	packages/git-tool/src/cache/git-cache.ts
- D	packages/git-tool/src/errors.ts
- D	packages/git-tool/src/git-tool.ts
- D	packages/git-tool/src/index.ts
- D	packages/git-tool/src/operations/add.ts
- D	packages/git-tool/src/operations/blame.ts
- D	packages/git-tool/src/operations/branch.ts
- D	packages/git-tool/src/operations/checkout.ts
- D	packages/git-tool/src/operations/cherry-pick.ts
- D	packages/git-tool/src/operations/commit.ts
- D	packages/git-tool/src/operations/diff.ts
- D	packages/git-tool/src/operations/fetch.ts
- D	packages/git-tool/src/operations/github/ci.ts
- D	packages/git-tool/src/operations/github/issue.ts
- D	packages/git-tool/src/operations/github/pr.ts
- D	packages/git-tool/src/operations/github/release.ts
- D	packages/git-tool/src/operations/log.ts
- D	packages/git-tool/src/operations/merge.ts
- D	packages/git-tool/src/operations/pull.ts
- D	packages/git-tool/src/operations/push.ts
- D	packages/git-tool/src/operations/rebase.ts
- D	packages/git-tool/src/operations/restore.ts
- D	packages/git-tool/src/operations/show.ts
- D	packages/git-tool/src/operations/stash.ts
- D	packages/git-tool/src/operations/status.ts
- D	packages/git-tool/src/operations/tag.ts
- D	packages/git-tool/src/parsers/blame-parser.ts
- D	packages/git-tool/src/parsers/diff-parser.ts
- D	packages/git-tool/src/parsers/log-parser.ts
- D	packages/git-tool/src/parsers/status-parser.ts
- D	packages/git-tool/src/render.ts
- D	packages/git-tool/src/safety/guards.ts
- D	packages/git-tool/src/safety/policies.ts
- D	packages/git-tool/src/types.ts
- D	packages/git-tool/src/utils.ts
- D	packages/git-tool/test/cache.test.ts
- D	packages/git-tool/test/helpers.ts
- D	packages/git-tool/test/parsers.test.ts
- D	packages/git-tool/test/safety.test.ts
- D	packages/git-tool/tsconfig.build.json
- D	packages/git-tool/vitest.config.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/natives/CHANGELOG.md
- A	packages/natives/README.md
- A	packages/natives/bench/grep.ts
- A	packages/natives/package.json
- A	packages/natives/scripts/build-native.ts
- A	packages/natives/scripts/embed-native.ts
- A	packages/natives/src/appearance/index.ts
- A	packages/natives/src/appearance/types.ts
- A	packages/natives/src/ast/index.ts
- A	packages/natives/src/ast/types.ts
- A	packages/natives/src/bindings.ts
- A	packages/natives/src/clipboard/index.ts
- A	packages/natives/src/clipboard/types.ts
- A	packages/natives/src/embedded-addon.ts
- A	packages/natives/src/glob/index.ts
- A	packages/natives/src/glob/types.ts
- A	packages/natives/src/grep/index.ts
- A	packages/natives/src/grep/types.ts
- A	packages/natives/src/highlight/index.ts
- A	packages/natives/src/highlight/types.ts
- A	packages/natives/src/html/index.ts
- A	packages/natives/src/html/types.ts
- A	packages/natives/src/image/index.ts
- A	packages/natives/src/image/types.ts
- A	packages/natives/src/index.ts
- A	packages/natives/src/keys/index.ts
- A	packages/natives/src/keys/types.ts
- A	packages/natives/src/native.ts
- A	packages/natives/src/ps/index.ts
- A	packages/natives/src/ps/types.ts
- A	packages/natives/src/pty/index.ts
- A	packages/natives/src/pty/types.ts
- A	packages/natives/src/shell/index.ts
- A	packages/natives/src/shell/types.ts
- A	packages/natives/src/text/index.ts
- A	packages/natives/src/text/types.ts
- A	packages/natives/src/work/index.ts
- A	packages/natives/src/work/types.ts
- A	packages/natives/test/native.test.ts
- A	packages/natives/tsconfig.build.json
- A	packages/natives/tsconfig.json
- A	packages/natives/tsconfig.publish.json

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/react-edit-benchmark/fixtures.tar.gz

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/react-edit-benchmark/formatter.ts
- D	packages/react-edit-benchmark/mutations.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/react-edit-benchmark/package.json

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/react-edit-benchmark/runner.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/react-edit-benchmark/runs/claude-haiku-4-5_hashline-nointent_2026-02-18T03-54-16.md
- A	packages/react-edit-benchmark/runs/claude-haiku-4-5_hashline_2026-02-11T06-43-50.md
- A	packages/react-edit-benchmark/runs/claude-haiku-4-5_hashline_2026-02-18T03-40-14.md
- A	packages/react-edit-benchmark/runs/claude-haiku-4-5_hashline_2026-02-19T13-42-11.md
- A	packages/react-edit-benchmark/runs/claude-haiku-4-5_hashline_2026-02-19T19-25-55.md
- A	packages/react-edit-benchmark/runs/claude-haiku-4-5_patch_2026-02-10T15-13-20.md
- A	packages/react-edit-benchmark/runs/claude-haiku-4-5_patch_2026-02-11T06-05-06.md
- A	packages/react-edit-benchmark/runs/claude-haiku-4-5_replace_2026-02-11T06-04-50.md
- A	packages/react-edit-benchmark/runs/claude-haiku-4-5_replace_2026-02-18T04-01-12.md
- A	packages/react-edit-benchmark/runs/claude-opus-4-6_hashline_2026-02-16T13-37-15.md
- A	packages/react-edit-benchmark/runs/claude-sonnet-4-5_hashline_2026-02-20T10-45-36.md
- A	packages/react-edit-benchmark/runs/claude-sonnet-4-5_patch_2026-02-10T15-03-14.md
- A	packages/react-edit-benchmark/runs/claude-sonnet-4-6_hashline-nointent_2026-02-18T03-54-25.md
- A	packages/react-edit-benchmark/runs/claude-sonnet-4-6_hashline_2026-02-18T03-42-21.md
- A	packages/react-edit-benchmark/runs/claude-sonnet-4-6_hashline_2026-02-19T09-04-31.md
- A	packages/react-edit-benchmark/runs/claude-sonnet-4-6_replace_2026-02-18T04-03-01.md
- A	packages/react-edit-benchmark/runs/claude-sonnet-4_5_hashline_2026-02-11T05-45-11.md
- A	packages/react-edit-benchmark/runs/claude-sonnet-4_5_patch_2026-02-11T05-45-04.md
- A	packages/react-edit-benchmark/runs/claude-sonnet-4_5_patch_2026-02-11T06-06-43.md
- A	packages/react-edit-benchmark/runs/claude-sonnet-4_5_replace_2026-02-11T05-45-21.md
- A	packages/react-edit-benchmark/runs/claude-sonnet-4_5_replace_2026-02-11T06-06-53.md
- A	packages/react-edit-benchmark/runs/deepseek-v3_2_hashline_2026-02-11T09-41-20.md
- A	packages/react-edit-benchmark/runs/deepseek-v3_2_patch_2026-02-11T09-41-36.md
- A	packages/react-edit-benchmark/runs/deepseek-v3_2_replace_2026-02-11T09-40-34.md
- A	packages/react-edit-benchmark/runs/devstral-medium_hashline_2026-02-11T09-35-48.md
- A	packages/react-edit-benchmark/runs/devstral-medium_hashline_2026-02-20T10-20-24.md
- A	packages/react-edit-benchmark/runs/devstral-medium_patch_2026-02-11T09-38-39.md
- A	packages/react-edit-benchmark/runs/devstral-medium_replace_2026-02-11T09-35-12.md
- A	packages/react-edit-benchmark/runs/gemini-2_5-flash-lite_hashline_2026-02-10T16-40-51.md
- A	packages/react-edit-benchmark/runs/gemini-2_5-flash-lite_patch_2026-02-10T15-39-13.md
- A	packages/react-edit-benchmark/runs/gemini-2_5-flash-lite_patch_2026-02-11T04-59-39.md
- A	packages/react-edit-benchmark/runs/gemini-2_5-flash-lite_replace_2026-02-11T04-59-14.md
- A	packages/react-edit-benchmark/runs/gemini-3-flash_hashline_2026-02-11T08-44-04.md
- A	packages/react-edit-benchmark/runs/gemini-3-flash_hashline_2026-02-19T19-18-54.md
- A	packages/react-edit-benchmark/runs/gemini-3-flash_patch_2026-02-11T06-05-11.md
- A	packages/react-edit-benchmark/runs/gemini-3-flash_replace_2026-02-11T06-06-08.md
- A	packages/react-edit-benchmark/runs/glm-4_5-air_hashline_2026-02-11T04-59-01.md
- A	packages/react-edit-benchmark/runs/glm-4_5-air_hashline_2026-02-20T10-21-02.md
- A	packages/react-edit-benchmark/runs/glm-4_5-air_patch_2026-02-10T17-35-53.md
- A	packages/react-edit-benchmark/runs/glm-4_5-air_patch_2026-02-11T04-50-49.md
- A	packages/react-edit-benchmark/runs/glm-4_5-air_patch_2026-02-11T06-10-55.md
- A	packages/react-edit-benchmark/runs/glm-4_5-air_replace_2026-02-11T04-50-01.md
- A	packages/react-edit-benchmark/runs/glm-4_5-air_replace_2026-02-11T06-10-21.md
- A	packages/react-edit-benchmark/runs/glm-4_7_hashline_2026-02-20T10-37-47.md
- A	packages/react-edit-benchmark/runs/glm-4_7_patch_2026-02-10T17-39-32.md
- A	packages/react-edit-benchmark/runs/glm-5_hashline-nointent_2026-02-18T03-55-35.md
- A	packages/react-edit-benchmark/runs/glm-5_hashline_2026-02-18T03-41-22.md
- A	packages/react-edit-benchmark/runs/glm-5_replace_2026-02-18T04-07-06.md
- A	packages/react-edit-benchmark/runs/gpt-5_1-codex-mini_hashline_2026-02-11T09-29-46.md
- A	packages/react-edit-benchmark/runs/gpt-5_1-codex-mini_hashline_2026-02-20T10-38-45.md
- A	packages/react-edit-benchmark/runs/gpt-5_1-codex-mini_patch_2026-01-19T14-49-47.md
- A	packages/react-edit-benchmark/runs/gpt-5_1-codex-mini_patch_2026-01-19T15-05-03.md
- A	packages/react-edit-benchmark/runs/gpt-5_1-codex-mini_patch_2026-02-10T16-05-12.md
- A	packages/react-edit-benchmark/runs/gpt-5_1-codex-mini_replace_2026-02-11T09-26-14.md
- A	packages/react-edit-benchmark/runs/gpt-5_2-codex_hashline-nointent_2026-02-18T03-48-06.md
- A	packages/react-edit-benchmark/runs/gpt-5_2-codex_hashline_2026-02-11T07-25-36.md
- A	packages/react-edit-benchmark/runs/gpt-5_2-codex_hashline_2026-02-18T03-41-06.md
- A	packages/react-edit-benchmark/runs/gpt-5_2-codex_hashline_2026-02-19T13-46-54.md
- A	packages/react-edit-benchmark/runs/gpt-5_2-codex_patch_2026-02-11T07-19-41.md
- A	packages/react-edit-benchmark/runs/gpt-5_2-codex_replace_2026-02-11T06-56-09.md
- A	packages/react-edit-benchmark/runs/gpt-5_2-codex_replace_2026-02-18T03-57-33.md
- A	packages/react-edit-benchmark/runs/gpt-5_3-codex-spark_hashline_2026-02-20T10-10-16.md
- A	packages/react-edit-benchmark/runs/gpt-5_3-codex-spark_patch_2026-02-20T10-08-40.md
- A	packages/react-edit-benchmark/runs/gpt-5_3-codex_hashline_2026-02-12T18-12-01.md
- A	packages/react-edit-benchmark/runs/gpt-5_3-codex_hashline_2026-02-15T14-03-31.md
- A	packages/react-edit-benchmark/runs/gpt-5_3-codex_hashline_2026-02-15T14-33-41.md
- A	packages/react-edit-benchmark/runs/gpt-5_3-codex_patch_2026-02-12T18-12-40.md
- A	packages/react-edit-benchmark/runs/gpt-5_3-codex_replace_2026-02-12T18-15-09.md
- A	packages/react-edit-benchmark/runs/gpt-5_3-codex_replace_2026-02-15T14-36-09.md
- A	packages/react-edit-benchmark/runs/grok-4-1-fast_hashline_2026-02-11T08-49-14.md
- A	packages/react-edit-benchmark/runs/grok-4-1-fast_hashline_2026-02-15T14-05-59.md
- A	packages/react-edit-benchmark/runs/grok-4-1-fast_hashline_2026-02-15T14-35-04.md
- A	packages/react-edit-benchmark/runs/grok-4-1-fast_hashline_2026-02-20T10-02-55.md
- A	packages/react-edit-benchmark/runs/grok-4-1-fast_hashline_2026-02-22T22-18-11.md
- A	packages/react-edit-benchmark/runs/grok-4-1-fast_patch_2026-02-11T08-24-44.md
- A	packages/react-edit-benchmark/runs/grok-4-1-fast_replace_2026-02-11T09-13-21.md
- A	packages/react-edit-benchmark/runs/grok-4-fast-non-reasoning_hashline_2026-02-11T08-39-28.md
- A	packages/react-edit-benchmark/runs/grok-4-fast-non-reasoning_hashline_2026-02-20T09-56-59.md
- A	packages/react-edit-benchmark/runs/grok-4-fast-non-reasoning_patch_2026-02-10T15-29-33.md
- A	packages/react-edit-benchmark/runs/grok-4-fast-non-reasoning_patch_2026-02-11T06-04-36.md
- A	packages/react-edit-benchmark/runs/grok-4-fast-non-reasoning_replace_2026-02-11T06-04-06.md
- A	packages/react-edit-benchmark/runs/grok-code-fast-1_hashline_2026-02-11T08-27-24.md
- A	packages/react-edit-benchmark/runs/grok-code-fast-1_hashline_2026-02-20T10-45-19.md
- A	packages/react-edit-benchmark/runs/grok-code-fast-1_patch_2026-02-11T08-35-38.md
- A	packages/react-edit-benchmark/runs/grok-code-fast-1_replace_2026-02-11T09-24-06.md
- A	packages/react-edit-benchmark/runs/kimi-k2_5_hashline_2026-02-11T08-58-08.md
- A	packages/react-edit-benchmark/runs/kimi-k2_5_hashline_2026-02-20T09-59-49.md
- A	packages/react-edit-benchmark/runs/kimi-k2_5_patch_2026-02-11T07-14-30.md
- A	packages/react-edit-benchmark/runs/kimi-k2_5_replace_2026-02-11T07-39-12.md
- A	packages/react-edit-benchmark/runs/minimax-m2_1_hashline_2026-02-11T09-33-40.md
- A	packages/react-edit-benchmark/runs/minimax-m2_1_hashline_2026-02-20T10-08-54.md
- A	packages/react-edit-benchmark/runs/minimax-m2_1_patch_2026-02-11T09-37-00.md
- A	packages/react-edit-benchmark/runs/minimax-m2_1_replace_2026-02-11T09-34-23.md
- A	packages/react-edit-benchmark/runs/qwen-turbo_hashline_2026-02-11T06-50-08.md
- A	packages/react-edit-benchmark/runs/qwen-turbo_patch_2026-02-11T06-10-23.md
- A	packages/react-edit-benchmark/runs/qwen-turbo_replace_2026-02-11T06-09-29.md
- A	packages/react-edit-benchmark/runs/zai-glm-4_7_hashline_2026-02-11T08-25-55.md
- A	packages/react-edit-benchmark/runs/zai-glm-4_7_patch_2026-02-11T08-32-00.md
- A	packages/react-edit-benchmark/runs/zai-glm-4_7_replace_2026-02-11T09-18-06.md

## Fork-renamed files (port = map to upstream layout)
- R097	packages/react-edit-benchmark/bun-imports.d.ts	packages/react-edit-benchmark/src/bun-imports.d.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/react-edit-benchmark/src/formatter.ts

## Fork-renamed files (port = map to upstream layout)
- R058	packages/react-edit-benchmark/generate.ts	packages/react-edit-benchmark/src/generate.ts
- R051	packages/react-edit-benchmark/index.ts	packages/react-edit-benchmark/src/index.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/react-edit-benchmark/src/mutations.ts
- A	packages/react-edit-benchmark/src/prompts/benchmark-task.md

## Fork-renamed files (port = map to upstream layout)
- R079	packages/react-edit-benchmark/report.ts	packages/react-edit-benchmark/src/report.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/react-edit-benchmark/src/runner.ts

## Fork-renamed files (port = map to upstream layout)
- R058	packages/react-edit-benchmark/tasks.ts	packages/react-edit-benchmark/src/tasks.ts
- R076	packages/react-edit-benchmark/verify.ts	packages/react-edit-benchmark/src/verify.ts

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	packages/react-edit-benchmark/tarball.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/react-edit-benchmark/test/formatter.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/react-edit-benchmark/test/verify.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/react-edit-benchmark/tsconfig.build.json

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/react-edit-benchmark/tsconfig.json

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/react-edit-benchmark/tsconfig.publish.json
- A	packages/stats/README.md
- A	packages/stats/build.ts
- A	packages/stats/package.json
- A	packages/stats/scripts/generate-client-bundle.ts
- A	packages/stats/src/aggregator.ts
- A	packages/stats/src/client/App.tsx
- A	packages/stats/src/client/api.ts
- A	packages/stats/src/client/components/ChartsContainer.tsx
- A	packages/stats/src/client/components/Header.tsx
- A	packages/stats/src/client/components/ModelsTable.tsx
- A	packages/stats/src/client/components/RequestDetail.tsx
- A	packages/stats/src/client/components/RequestList.tsx
- A	packages/stats/src/client/components/StatsGrid.tsx
- A	packages/stats/src/client/css.d.ts
- A	packages/stats/src/client/index.tsx
- A	packages/stats/src/client/styles.css
- A	packages/stats/src/client/types.ts
- A	packages/stats/src/client/useSystemTheme.ts
- A	packages/stats/src/db.ts
- A	packages/stats/src/embedded-client.generated.txt
- A	packages/stats/src/index.ts
- A	packages/stats/src/parser.ts
- A	packages/stats/src/server.ts
- A	packages/stats/src/types.ts
- A	packages/stats/tailwind.config.js
- A	packages/stats/tsconfig.build.json
- A	packages/stats/tsconfig.client.json
- A	packages/stats/tsconfig.json
- A	packages/stats/tsconfig.publish.json
- A	packages/swarm-extension/.gitignore
- A	packages/swarm-extension/README.md
- A	packages/swarm-extension/package.json
- A	packages/swarm-extension/src/cli.ts
- A	packages/swarm-extension/src/extension.ts
- A	packages/swarm-extension/src/swarm/dag.ts
- A	packages/swarm-extension/src/swarm/executor.ts
- A	packages/swarm-extension/src/swarm/pipeline.ts
- A	packages/swarm-extension/src/swarm/render.ts
- A	packages/swarm-extension/src/swarm/schema.ts
- A	packages/swarm-extension/src/swarm/state.ts
- A	packages/swarm-extension/tsconfig.json

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/tui/CHANGELOG.md
- M	packages/tui/README.md

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/tui/bench/_jskey.ts
- A	packages/tui/bench/kitty-sequence.ts
- A	packages/tui/bench/parse-key.ts
- A	packages/tui/bench/sanitize.ts
- A	packages/tui/bench/text-layout.ts
- A	packages/tui/bench/width.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/tui/package.json
- M	packages/tui/src/autocomplete.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/tui/src/bracketed-paste.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/tui/src/components/box.ts
- M	packages/tui/src/components/cancellable-loader.ts
- M	packages/tui/src/components/editor.ts
- M	packages/tui/src/components/image.ts
- M	packages/tui/src/components/input.ts
- M	packages/tui/src/components/loader.ts
- M	packages/tui/src/components/markdown.ts
- M	packages/tui/src/components/select-list.ts
- M	packages/tui/src/components/settings-list.ts
- M	packages/tui/src/components/spacer.ts
- M	packages/tui/src/components/tab-bar.ts
- M	packages/tui/src/components/text.ts
- M	packages/tui/src/components/truncated-text.ts
- M	packages/tui/src/editor-component.ts
- M	packages/tui/src/fuzzy.ts
- M	packages/tui/src/index.ts
- M	packages/tui/src/keybindings.ts
- M	packages/tui/src/keys.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/tui/src/kill-ring.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/tui/src/stdin-buffer.ts
- M	packages/tui/src/symbols.ts

## Fork-renamed files (port = map to upstream layout)
- R050	packages/tui/src/terminal-image.ts	packages/tui/src/terminal-capabilities.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/tui/src/terminal.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/tui/src/ttyid.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/tui/src/tui.ts
- M	packages/tui/src/utils.ts
- M	packages/tui/test/autocomplete.test.ts
- M	packages/tui/test/chat-simple.ts
- M	packages/tui/test/editor.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/tui/test/image-render.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/tui/test/image-test.ts
- M	packages/tui/test/key-tester.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/tui/test/keys.test.ts
- A	packages/tui/test/loader.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/tui/test/markdown.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/tui/test/overlay-scroll.test.ts
- A	packages/tui/test/render-regressions.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/tui/test/stdin-buffer.test.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/tui/test/tab-bar.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/tui/test/test-themes.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/tui/test/text-utils.test.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	packages/tui/test/truncated-text.test.ts
- M	packages/tui/test/virtual-terminal.ts
- M	packages/tui/test/wrap-ansi.test.ts
- M	packages/tui/tsconfig.build.json

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	packages/tui/tsconfig.json
- A	packages/tui/tsconfig.publish.json
- A	packages/utils/package.json
- A	packages/utils/src/abortable.ts
- A	packages/utils/src/async.ts
- A	packages/utils/src/cli.ts
- A	packages/utils/src/color.ts
- A	packages/utils/src/dirs.ts
- A	packages/utils/src/env.ts
- A	packages/utils/src/format.ts
- A	packages/utils/src/fs-error.ts
- A	packages/utils/src/glob.ts
- A	packages/utils/src/indent.ts
- A	packages/utils/src/index.ts
- A	packages/utils/src/json.ts
- A	packages/utils/src/logger.ts
- A	packages/utils/src/mermaid-ascii.ts
- A	packages/utils/src/postmortem.ts
- A	packages/utils/src/procmgr.ts
- A	packages/utils/src/ptree.ts
- A	packages/utils/src/ring.ts
- A	packages/utils/src/snowflake.ts
- A	packages/utils/src/stream.ts
- A	packages/utils/src/temp.ts
- A	packages/utils/src/type-guards.ts
- A	packages/utils/test/ring.test.ts
- A	packages/utils/test/spacing.test.ts
- A	packages/utils/test/stream.test.ts
- A	packages/utils/tsconfig.build.json
- A	packages/utils/tsconfig.json
- A	packages/utils/tsconfig.publish.json

## Fork-deleted paths (port = verify upstream replacement covers it)
- D	pi-mono.code-workspace

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	rust-analyzer.toml
- A	rust-toolchain.toml
- A	rustfmt.toml

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	scripts/dump-edit-history.ts
- M	scripts/install-tests/binary.dockerfile

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	scripts/install-tests/run-ci.sh

## Fork-renamed files (port = map to upstream layout)
- R068	scripts/install-tests/run.sh	scripts/install-tests/run-podman.sh

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	scripts/install-tests/source.dockerfile

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	scripts/install-tests/tarball.dockerfile

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	scripts/install.ps1
- M	scripts/install.sh
- M	scripts/release.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	scripts/repro-stuck.ts
- A	scripts/sync-exports.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	scripts/sync-themes.ts

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	scripts/trace-loader.ts

## Fork-modified files (port = re-apply fork edits onto upstream version)
- M	tsconfig.base.json
- M	tsconfig.json

## Fork-added files (port = reintroduce + adapt to upstream APIs)
- A	types/assets/index.d.ts
