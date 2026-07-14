# Cline v3.35.0 → v3.82.0 Triage Report (for AI-Hydro fork)

> **Sync cadence:** see `DECISIONS.md` (2026-07-08 entry) — quarterly batches
> with a security fast-path. Next scheduled sync: **2026-08-10**.

## Ported (Batch 1 + Batch 2 — 2026-05-10)

### Batch 1 (commit `592293271`, `552c42114`, `8ccba590b`)
- ✅ v3.80.0 OOM fix: `--max-old-space-size=8192` for cline-core
- ✅ v3.79.0 Action injection security fix in publish.yml
- ✅ v3.73.0 Graceful tool errors: list_files, list_code_definition_names, search_files
- ✅ v3.76.0 Repeated tool call loop detection (soft warn at 3, hard escalation at 5)
- ✅ v3.74.0 File read deduplication cache (mtime eviction, readCount tracking)
- ✅ v3.80.0 Incremental .gitignore scanning in list-files to fix OOM on large repos
- ✅ v3.71.0 StreamableHTTP MCP reconnect with exponential backoff
- ✅ v3.69.0 Checkpoint: retry nested git restore, throw on rename failure (`retryWithBackoff`)

### Batch 2 (commits `7bdf2a9c3`, `97d982784`, `b28d26110`, `575a6dfce`, `d66d6635d`, `c142defb6`, `653d5af83`)
- ✅ v3.57.0 write_to_file infinite retry fix + progressive 3-tier missing-content error
- ✅ v3.82.0 Chunked read_file with start_line/end_line + 1000-line default limit
- ✅ v3.78.0 Surface read_file line ranges in chat UI message
- ✅ v3.79.0 claude-opus-4-7 added to Anthropic, Bedrock, Vertex, ClaudeCode model registries
- ✅ v3.49.1 LM Studio: chunk.choices?.[0] guard against null choices in usage chunks
- ✅ v3.70.0 State serialization: catch JSON errors in saveApiConversationHistory
- ✅ v3.41.0 secrets.json: set 0o600 permissions (owner-only read/write)
- ✅ v3.54.0 replace_in_file: increment mistake count on diff mismatch to prevent infinite retries

### Deferred (complex / needs upstream diff)
- ⏳ v3.58.0 Duplicate streamed text rows after completion
- ⏳ v3.79.0 Stuck command_output ask when terminal closes unexpectedly
- ⏳ v3.69.0 Trigger auto-compaction on OpenRouter context overflow errors
- ⏳ v3.41.0 Non-blocking initial checkpoint commit

---

## Executive Summary

48 minor releases shipped between fork (v3.34.0) and v3.82.0, dominated by (1) a steady stream of model/provider additions (Claude Opus 4.5/4.6/4.7, Gemini 3 Pro/Flash, GPT-5/5.1/5.2/5.3/5.4/5.5, GLM 4.6/4.7/5, Kimi K2.5, Devstral, MiniMax variants, Nova 2 Lite, etc.), (2) major new agent infrastructure (Skills system, Hooks system, Subagents, native tool calling, MCP prompts, remote config, CLI 2.0/Kanban), and (3) routine bugfixes around streaming, diff view, terminal, and provider quirks. Top three themes: **provider/model breadth**, **new agent primitives (Skills/Hooks/Subagents)**, and **enterprise/remote-config plumbing** — most of which is domain-neutral and high-value to port, but the Skills/Hooks/Kanban/Subagents systems all touch UI surfaces that AI-Hydro has rebranded.

---

## A. PORT — High value, low risk

Bug fixes, perf, security, providers, MCP, infrastructure.

### Security / stability
- **v3.80.0**: "Fix OOM crashes during long conversations by setting `--max-old-space-size=8192` for the cline-core Node.js process (was defaulting to ~2 GB)" — direct port, large repos.
- **v3.81.0**: cline-core memory diagnostics (heap snapshots, periodic memory logging, OOM debug logs) — pure infra.
- **v3.79.0**: "Fix action injection security risk" — security fix, port.
- **v3.62.0**: "Resolved 17 security vulnerabilities including high-severity DoS issues in dependencies (body-parser, axios, qs, tar, and others)" — bump deps.
- **v3.80.0**: "Update `axios` to 1.15.0 across all packages" — dep bump.
- **v3.68.0**: "Use `JSON_SCHEMA` for `yaml.load` to prevent unsafe deserialization" — security fix.
- **v3.41.0**: "Restrictive file permissions for secrets.json" — security.
- **v3.47.0**: "Prevent expired token usage in authenticated requests" — security/auth.

### Tool/handler robustness
- **v3.73.0**: "Tool handlers (`read_file`, `list_files`, `list_code_definition_names`, `search_files`) now return graceful errors instead of crashing" — high value.
- **v3.72.0**: "Prevent crash when `list_files` or `list_code_definition_names` receives a file path".
- **v3.74.0**: "Add file read deduplication cache to prevent repeated reads" — perf.
- **v3.77.0**: "`read_file` tool now supports chunked reading for targeted file access" — useful for large hydro datasets/CSVs.
- **v3.78.0**: "Show actual `read_file` line ranges in chat UI".
- **v3.76.0**: "Add repeated tool call loop detection to prevent infinite loops wasting tokens" — high value.
- **v3.65.0**: "Fix infinite retry loop when write_to_file fails with missing content parameter".
- **v3.54.0**: "Prevent infinite retry loops when replace_in_file fails repeatedly".
- **v3.57.0**: "Fix read file tool to support reading large files".

### Streaming / state
- **v3.79.0**: "Fix stuck `command_output` ask when terminal command ends unexpectedly".
- **v3.70.0**: "State serialization errors are now caught and logged instead of crashing".
- **v3.70.0**: "Token/cost updates now happen immediately as usage chunks arrive, not after tool execution".
- **v3.58.0**: "Task streaming: prevent duplicate streamed text rows after completion".
- **v3.54.0**: "Throttle diff view updates during streaming to reduce UI flickering".
- **v3.54.0**: "Skip diff error UI handling during streaming to prevent flickering".
- **v3.49.1**: "Fix crash when OpenAI-compatible APIs send usage chunks with empty or null choices arrays".
- **v3.69.0**: "Trigger auto-compaction on OpenRouter context overflow errors".
- **v3.65.0**: "Fix aggressive context compaction caused by accidental clicks on the context window progress bar".

### Terminal / checkpoints
- **v3.82.0**: "Restore VS Code foreground terminal support and settings" (note: v3.80 removed it, v3.82 restored — port end state).
- **v3.58.0**: "Terminal: surface command exit codes in results and improve long-running `execute_command` timeout behavior".
- **v3.69.0**: "Retry nested git restore and prevent silent `.git_disabled` leftovers in checkpoints".
- **v3.69.0**: "Prevent Chinese filename escaping in diff view".
- **v3.41.0**: "Initial checkpoint commit now non-blocking for improved responsiveness in large repositories".
- **v3.40.0**: "Fix a bug where terminal commands with double quotes are broken when 'Terminal Execution Mode' is set to 'Background Exec'".
- **v3.46.0**: "Enhanced background terminal execution with command tracking, log file output, zombie process prevention (10-minute timeout), and clickable log paths in UI".

### Provider / model additions (domain-neutral)
- **v3.79.0**: Claude Opus 4.7.
- **v3.38.2**: Claude Opus 4.5; **v3.57.0/v3.57.1**: Opus 4.6 (+ Bedrock fix); **v3.72.0**: Opus 4.6 fast variants.
- **v3.64.0**: Sonnet 4.6; **v3.54.0**: "Sonnet 4.5 is now the default Amazon Bedrock model id".
- **v3.45.0**: Gemini 3 Flash Preview; **v3.66.0**: Gemini-3.1 Pro Preview.
- **v3.38.0**: Gemini 3 Pro Preview.
- **v3.41.0**: GPT-5.2; **v3.50.0/3.51.0**: gpt-5.2-codex; **v3.71.0**: GPT-5.4; **v3.81.0**: GPT-5.5.
- **v3.37.0/v3.37.1**: GPT-5.1 + model-specific prompting.
- **v3.43.0**: GLM-4.6, kat-coder-pro; **v3.46.0**: GLM 4.7; **v3.58.0**: GLM-5.
- **v3.55.0**: Arcee Trinity Large Preview, Moonshot Kimi K2.5; **v3.56.0**: Kimi-K2.5 in Moonshot provider.
- **v3.34.1/v3.59.0/v3.47.0**: MiniMax M2/M2.1/2.5.
- **v3.41.0**: Amazon Nova 2 Lite, DeepSeek 3.2 native tool calling.
- **v3.41.0/v3.39.0**: microwave / Devstral-2512.
- **v3.38.3**: Grok 4.1, Grok Code in XAI.
- **v3.73.0**: "W&B Inference by CoreWeave as a new API provider with 17 models".
- **v3.79.0**: "Add Azure Blob Storage as a storage provider".
- **v3.54.0**: "Native tool calls support for Ollama provider".
- **v3.36.0**: "new provider AIhubmix"; **v3.35.1**: "Hicap API integration as provider".
- **v3.37.0**: "Nous Research provider with Hermes 4 model family".
- **v3.82.0**: "Add latest OpenAI, SAP AI Core, and Z AI models".

### Provider bugfixes (broad, domain-neutral)
- **v3.79.0**: "Fix cache reflection for Cline and Vercel API handlers".
- **v3.74.0**: "Skip WebP for GLM and Devstral models running through llama.cpp".
- **v3.74.0**: "Respect user-configured context window in LiteLLM getModel()".
- **v3.74.0**: "Honor explicit model IDs outside static catalog in W&B provider".
- **v3.74.0**: "Add missing Fireworks serverless models and pricing".
- **v3.73.0**: "Claude Code Provider: handle rate limit events, empty content arrays, error results, and unknown content types without crashing".
- **v3.72.0**: "Gemini: capped Flash output tokens to 8192 across providers".
- **v3.72.0**: "Bedrock: handle thinking and redacted_thinking blocks correctly".
- **v3.70.0**: "Removed incorrect `max_tokens` from OpenRouter requests".
- **v3.68.0**: "Update stale `maxTokens` values for Claude 3.7+ models across Anthropic, Bedrock, Vertex, and SAP AI Core".
- **v3.68.0**: "Use `model.info.maxTokens` for OpenRouter instead of hardcoded `8192`".
- **v3.67.0**: "Fix reasoning delta crash on usage-only stream chunks".
- **v3.41.0**: "Gemini Vertex models erroring when thinking parameters are not supported".
- **v3.41.0**: "Ollama streaming requests not aborting when task is cancelled".
- **v3.43.0**: "TLS Proxy support issues for VSCode".
- **v3.43.0**: "Fix invalid signature field issues when switching between Gemini and Anthropic providers".
- **v3.38.1**: "Fixed handling of 'signature' field in sanitizeAnthropicContentBlock".
- **v3.50.0**: "Fix invalid tool call IDs when switching between model formats".
- **v3.36.1**: native tool calling fixes for Gemini/XAI/Grok.
- **v3.40.2**: "Fix logout on network errors during token refresh".
- **v3.40.1**: "Fix cost calculation display for Anthropic API requests".
- **v3.69.0**: "Restore GPT-OSS native file editing on OpenAI-compatible models".
- **v3.47.0**: "Fix Cerebras rate limiting"; "Disable native tool calling for Deepseek 3.2 speciale".

### MCP improvements (high relevance — AI-Hydro is MCP-heavy)
- **v3.71.0**: "Handle streamable HTTP MCP reconnects more reliably after disconnects" — port.
- **v3.55.0**: "Add MCP prompts support — prompts from connected MCP servers now appear in slash command autocomplete as `/mcp:<server>:<prompt>`" — high value for AI-Hydro tools.
- **v3.49.0**: "Improved image display in MCP responses".
- **v3.47.0**: "Fix remote MCP server connection failures (404 response handling)".
- **v3.45.1**: "Fixed MCP settings race condition where toggling auto-approve or changing timeout settings would cause the UI to flash and revert".
- **v3.44.1**: "Fixed a critical bug where local MCP servers stopped connecting after v3.42.0 — all user-configured stdio-based MCP servers should now work again" — **CRITICAL** for AI-Hydro stdio MCP server.
- **v3.43.0**: "Add parsing of env variable patterns to the mcpconfig.json".

### Misc infra
- **v3.82.0**: "Improve ripgrep file search error handling".
- **v3.82.0**: "Fix hook template JSON escaping".
- **v3.67.1**: "Use `isLocatedInPath()` instead of string matching for path containment checks".
- **v3.68.0**: "Resolve 'Could not find the file context' error in Explain Changes".
- **v3.68.0**: "Generate commit message from staged changes only when staging exists".
- **v3.49.1**: "Fix workflow slash command search to be case-insensitive".
- **v3.37.0**: "Expanded HTTP proxy support throughout the codebase".
- **v3.36.0**: "Use http_proxy, https_proxy and no_proxy in JetBrains".
- **v3.37.0**: "XML entity escaping in model content processor".
- **v3.37.0**: "Duplicate tool results prevention through existence checking".
- **v3.40.0**: "Fix Standalone, ensure cwd is the install dir to find resources reliably".
- **v3.47.0**: "Exclude binary files without extensions from diffs"; "Preserve file endings and trailing newlines".

---

## B. PORT WITH CARE — High value, conflict risk

Touches webview-ui, renamed `Cline*`/`AiHydro*` types, or Plan/Act mode.

### Skills system (touches system prompt, settings, webview)
- **v3.48.0**: "Add Skills system for reusable, on-demand agent instructions" — significant new subsystem; useful for hydro workflows but touches webview/settings.
- **v3.49.1**: "Add telemetry to track usage of skills feature" — strip telemetry but keep wiring.
- **v3.57.0**: "Make skills always enabled and remove feature toggle setting".
- **v3.65.0**: "Add /skills slash command to CLI for viewing and managing installed skills".
- **v3.67.0**: "Add support for skills and optional modelId in subagent configuration".
- **v3.67.0**: "Add AgentConfigLoader for file-based agent configs".
- **v3.50.0**: "Add create-pull-request skill".
- **v3.67.0**: "Move PR skill to .agents/skills".
- **v3.80.0**: "Wire up remote `globalSkills` from enterprise remote config with full UI, toggle support, and system prompt integration" — webview-heavy.
- **v3.79.0**: "Add `globalSkills` to remote config".

### Hooks system (touches lifecycle, settings)
- **v3.36.0**: "Hooks allow you to inject custom logic into Cline's workflow" — major.
- **v3.71.0**: "Hooks: Added a `Notification` hook for attention and completion boundaries".
- **v3.77.0**: "Polish `Notification` hook functionality".
- **v3.70.0**: "Hook payloads now include `model.provider` and `model.slug`".
- **v3.72.0**: "Hooks: reintroduced feature toggle".
- **v3.69.0**: "Improve hooks support for Windows PowerShell".
- **v3.56.0**: "Hook scripts now run from the workspace repository root instead of filesystem root".
- **v3.38.3**: "Expanded Hooks functionality".

### Subagents
- **v3.58.0**: "Subagent: replace legacy subagents with the native `use_subagents` tool".
- **v3.79.0**: "Add `use_subagents` to system prompt for GLM, Hermes, and XS models".
- **v3.70.0**: "Improve subagent context compaction logic"; "Subagent stream retry delay increased to reduce noise from transient failures".

### Native tool calling (touches prompt builders, tool plumbing)
- **v3.35.0**: "Add native tool calling support with configurable setting".
- **v3.39.0**: "Enable NTC (Native Tool Calling) by default".
- **v3.73.0**: "Improved parallel tool calling support for OpenRouter and Cline providers" — Cline-branded handler will need rename.
- **v3.58.0**: "Amazon Bedrock: support parallel tool calling".
- **v3.56.0**: parallel tool calling enabled by default.
- **v3.47.0**: "Modify prompts for parallel tool usage in Claude and Gemini 3 models".
- **v3.46.0**: "Apply Patch tool for GPT-5+ models (replacing current diff edit tools)" — diff-tool architecture change.

### Remote config / enterprise plumbing (touches settings, webview)
- **v3.79.0**: "Inline value reuse in user-level remote-config discovery".
- **v3.58.0**: "Remote config: new UI/options (including connection/test buttons) and support for syncing deletion of remotely configured MCP servers".
- **v3.49.0**: "Auto-sync remote MCP servers from remote config to local settings" — interacts with AI-Hydro's `ensureDefaultMcpServer.ts`.
- **v3.50.0**: "Fix the selection of remotely configured providers".
- **v3.56.0**: "CLI authentication: Added Vercel AI Gateway and Cline API key provider support" — Cline-branded but mechanism reusable.
- **v3.58.0**: "CLI provider selection: limit provider list to those remotely configured".
- **v3.58.0**: "Remotely configured MCP server schema now supports custom headers".
- **v3.44.1**: "Fixed remotely configured API keys not being extracted correctly for enterprise users".
- **v3.44.1**: "Added support for dynamic tool instructions that adapt based on runtime context".

### Webview-ui changes (heavily forked area)
- **v3.63.0**: "Restore reasoning trace visibility in chat and improve the thinking row UX so reasoning is visible, then collapsible after completion".
- **v3.74.0**: "Add feature tips tooltip during thinking state"; **v3.76.0**: "Add toggle to disable feature tips in chat".
- **v3.41.0**: "Welcome screen UI enhancements"; "Improvements to chat modal model picker".
- **v3.39.0**: "Add Tabbed Model Picker with Recommended and Free tabs".
- **v3.46.0**: "Banner carousel styling and dismiss functionality"; "Model picker favorites ordering, star toggle, and keyboard navigation".
- **v3.43.0**: "Migrate WhatsNewModal to new shared dialogue component".
- **v3.44.2**: model picker polish, WhatsNew responsiveness.
- **v3.42.0**: slash command/context menu accessibility, expand/collapse a11y; "Made slash command menu and context menu accessible and screenreader-friendly".
- **v3.40.0**: "Add support for slash commands anywhere in a message, not just at the beginning".
- **v3.40.0**: "Fix highlighted text flashing when task header is collapsed"; "Add bottom padding to last message".
- **v3.38.3**: "Removed Task Timeline from Task Header"; task export now opens task directory.
- **v3.58.0**: "UI: consolidate ViewHeader component/styling across views"; "UI: add loading indicator and fix `api_req_started` rendering".
- **v3.74.0**: "Align ClineRulesToggleModal padding with ServersToggleModal" — references `.clinerules`, AI-Hydro renamed to `.aihydrorules`.
- **v3.78.0**: "Add a dedicated 'Spend Limit Reached' error UI" / **v3.80.0**: "Quota Exceeded" error UI — cost UI; reuse plumbing, drop Cline copy.
- **v3.80.0**: "Show detailed error information in the chat error row instead of a generic caught error message" — high value, touches error component.
- **v3.39.0**: "Add Explain Changes feature" — new feature; **v3.68.0**: error fix related.
- **v3.39.0**: "Add support to View remote rules and workflows in the editor".
- **v3.67.0**: "Fix inline focus-chain slider within its feature row" / **v3.37.0**: "Improved focus chain prompting for frontier models".
- **v3.37.1**: "Add AGENTS.md support" — analogous to `.aihydrorules`/CLAUDE.md; consider whether to add `AGENTS.md` route.
- **v3.52.0**: "Comprehensive Jupyter Notebook support … AI-assisted editing of `.ipynb` files with full cell-level context awareness" — useful for hydro notebooks.
- **v3.54.0**: "Strip notebook cell outputs when extracting text content from Jupyter notebooks" — port together.
- **v3.41.0**: "Responses API support for Codex models in OpenAI provider"; **v3.67.0**: "Add Responses API support for OpenAI native provider"; **v3.49.1**: "Phase in Responses API usage instead of defaulting".

### Plan/Act / mode-related
- **v3.50.0**: "Fix act_mode_respond to prevent consecutive calls".
- **v3.44.2**: "tooltips on Plan/Act tabs".
- **v3.56.0**: "disabled strict plan mode by default".
- **v3.58.0**: "New 'double-check completion' experimental feature to verify work before marking tasks complete".
- **v3.77.0**: "Add 'Lazy Teammate Mode' experimental toggle"; "Exclude `new_task` tool from system prompt in yolo/headless mode".
- **v3.38.0**: "Removed new_task tool from system prompts".
- **v3.58.0**: "Tools: add auto-approval support for `attempt_completion` commands".
- **v3.35.0**: "Auto-approve is now always-on with a redesigned expanding menu" — webview UX.

### Settings UI / defaults
- **v3.56.0**: "Refreshed feature settings section with collapsible design"; "Enabled multi-root workspaces, parallel tool calling, and skills by default".
- **v3.58.0**: "Settings/model UX: move 'reasoning effort' into model configuration".
- **v3.35.0**: "Settings simplified and notifications moved to General Settings".

---

## C. SKIP — Cline-specific or marketing

- **v3.81.0**: "Remove hardcoded 'What's New' fallback items in webview; only remote-configured welcome banners are shown" — Cline banner system; AI-Hydro likely already strips.
- **v3.80.0**: "Add dedicated 'Quota Exceeded' error message in the chat error UI when **Cline account spend caps** are hit" — Cline billing; skip Cline-account branch, port generic plumbing if useful.
- **v3.80.0**: "Remove old hardcoded announcement banners".
- **v3.78.0**: "Add a dedicated 'Spend Limit Reached' error UI when **spend caps** are hit" — same.
- **v3.76.0**: "Add Cline Kanban launch modal in webview; CLI now launches Kanban by default with a migration view" — Cline product; skip.
- **v3.76.0**: "Fix CLI Kanban spawn on Windows".
- **v3.77.0**: "Fix Kanban demo video formatting".
- **v3.74.0**: "Implement dynamic free model detection for Cline API".
- **v3.74.0**: "Replace error message when not logged in to Cline".
- **v3.73.0**: parallel tool calling for "Cline providers" — keep mechanics, skip Cline-account-specific branch.
- **v3.70.0**: "New Cline API docs: Getting Started, Auth, Chat Completions, Models, Errors, and SDK Examples" — Cline docs.
- **v3.69.0**: "Add `User-Agent` header to requests sent to the Cline backend"; "Show Cline SDK docs on the Cline page"; "Update Cline SDK docs".
- **v3.68.0**: "Add dynamic Cline provider model fetching from Cline endpoint".
- **v3.67.1**: "Added Cline SDK API interface for programmatic access to Cline features".
- **v3.67.0**: "Pull Cline's recommended models from internal endpoint"; "Fetch featured models from backend with local fallback"; "Add dynamic flag to adjust banner cache duration".
- **v3.67.0**: "Fix Cline auth with ACP flag"; "Fix auth check for ACP mode".
- **v3.49.1**: "Add version headers to Cline backend requests".
- **v3.41.0**: "Xmas Special Santa Cline" — marketing.
- **v3.59.0/v3.55.0/v3.63.0**: free model promos (MiniMax 2.5, Kimi K2.5, ZAI GLM 5 Free promo) — Cline-promo.
- **v3.46.1**: "Remove GLM 4.6 from free models"; **v3.49.0**: "Removing Minimax-2.1 from free model list"; **v3.53.0**: "Removed grok model from free tier"; **v3.52.0**: "Grok models are now moving out of free tier and into paid plans"; **v3.54.0**: "Removed Mistral's Devstral-2512 free from the free models list"; **v3.34.1**: "Remove Cline/code-supernova-1-million model"; **v3.54.0**: "Removed deprecated zai-glm-4.6 model from Cerebras provider".
- **v3.69.0**: "Add default auto-tag workflow for publish release flow" — Cline release.
- **v3.67.0**: "Remove changeset-converter GitHub Action and npm run changeset" — Cline release.
- **v3.58.0**: "Telemetry: route PostHog networking through proxy-aware shared fetch and ensure telemetry flushes on shutdown" — Cline telemetry.
- **v3.56.0**: "Added community icons (X, Discord, GitHub, Reddit, LinkedIn) to the What's New modal" — Cline marketing.
- **v3.52.0**: "ChatGPT Plus or Pro subscriptions can now use GPT-5 models directly through Cline without needing an API key" — OAuth/Cline-branded; mechanism may be reusable but needs rebrand.
- **v3.50.0/v3.51.0**: same gpt-5.2-codex model picker change — port the model entry, skip Cline-promo framing.
- **v3.79.0**: "Remove deprecated evals tool".
- **v3.75.0**: "Remove example hooks in favor of reading the docs".
- **v3.72.0**: "Updated Jupyter Notebook GIFs"; "Added `.github/copilot-instructions.md` for coding agents" — repo-meta, AI-Hydro-equivalent already exists.
- **v3.82.0**: "Remove hardcoded model lists from docs" — docs.
- **v3.78.0**: "Docs updates".
- **v3.61.0/v3.60.0**: "UI/UX fixes with minimax model family" / "Fixes for Minimax model family" — provider-specific, low value unless using Minimax.
- **v3.44.0**: "Updating minor version to show a proper banner for the release" — banner-only.

### CLI-specific (Cline CLI / cline-core, AI-Hydro is VS Code extension only)
- **v3.57.0**: "Cline CLI 2.0 now available. Install with `npm install -g cline`".
- **v3.77.0**: "Exclude `new_task` tool from system prompt in yolo/headless mode" (CLI-specific).
- **v3.68.0**: "Add additional Markdown formatting in CLI"; "Add focus indicator on action buttons in extension" (extension keep, CLI skip).
- **v3.67.0**: "Add /q command to quit CLI"; "Fix CLI yolo mode to not persist yolo setting to disk".
- **v3.65.0**: "Add /skills slash command to CLI".
- **v3.63.0** etc.
- **v3.58.0**: CLI stdin handling, OAuth callback paths.
- **v3.41.0**/**v3.56.0**: CLI auth fixes.

### OTel / telemetry
- **v3.49.0**: "Enable configuring an OTEL collector at runtime" — useful infra; skip if AI-Hydro doesn't use OTel.
- **v3.56.0**: "OpenTelemetry: Added support for custom headers"; OTel endpoint path fix.

### Tests / CI
- **v3.75.0**: "Stabilize flaky hooks tests".
- **v3.72.0**: "Fixed Windows unit test path normalization"; "Fixed flaky hooks tests on Windows".
- **v3.70.0**: "Windows test cleanup now retries on locked files".
- **v3.68.0**: "Increase timeout for a flaky test".
- **v3.58.0**: "CI: increase Windows E2E test timeout".

---

## D. EVALUATE LATER — Needs product decision for AI-Hydro

- **v3.36.0** Hooks system overall — yes/no for hydro (probably yes; categorized B above) but needs scope decision: do we expose hooks in `.aihydrorules`?
- **v3.48.0** Skills system overall — does AI-Hydro want a skills marketplace alongside hydro tools, or just hydro tools? Decide before porting v3.49.1+v3.57+v3.65+v3.67+v3.80 follow-ups.
- **v3.58.0** Subagents (`use_subagents`) — competes with single-agent flow; could be valuable for multi-step hydro workflows but is a major architecture call.
- **v3.76.0** Cline Kanban — almost certainly **skip**, but flagging in case AI-Hydro wants a hydro-task board.
- **v3.67.1** Cline SDK programmatic API — mechanism could be reused as `aihydro-sdk`; product decision.
- **v3.52.0** ChatGPT Plus/Pro OAuth path — should AI-Hydro support OAuth-based subscription auth for OpenAI/Anthropic, or stay API-key-only?
- **v3.37.1** AGENTS.md support — should AI-Hydro adopt `AGENTS.md` as a sibling of `.aihydrorules`?
- **v3.38.0** AquaVoice / Avalon voice-to-text dictation; **v3.37.0** Linux STT support — niche; not hydro-relevant.
- **v3.39.0** "Explain Changes" feature — useful generally; conflicts unknown.
- **v3.46.0** Apply Patch tool for GPT-5+ replacing diff edit tools — architectural diff-tool decision.
- **v3.47.0** Background Edits (no diff view) — UX preference call.
- **v3.77.0** "Lazy Teammate Mode" experimental — niche, decide later.
- **v3.58.0** "double-check completion" experimental — verification cost vs. UX.
- **v3.34.1** OpenRouter manual model name entry — minor; decide.
- **v3.55.0** MCP prompts (`/mcp:<server>:<prompt>`) — listed in A but worth a product call: should AI-Hydro tools advertise prompts via this mechanism?
- **v3.75.0** "Latency improvements for remote workspaces" — only relevant if AI-Hydro supports remote workspaces; decide.
- **v3.47.0** "Azure based identity authentication in OpenAI Compatible provider" — enterprise auth call.
- **v3.79.0** Azure Blob Storage as a storage provider — what's "storage"? Verify scope before porting.

---

## Priority Port List (top 10 from bucket A)

1. **v3.44.1 — local stdio MCP server connection fix** (after v3.42 regression). AI-Hydro's entire MCP integration uses stdio. Critical.
2. **v3.80.0 — `--max-old-space-size=8192` fix for OOM crashes** on long conversations. Affects every long hydro session.
3. **v3.79.0 — action injection security fix**. Security.
4. **v3.62.0 — 17 dependency security vulnerabilities** (body-parser, axios, qs, tar). Security/dep bump.
5. **v3.73.0 — graceful errors for `read_file`/`list_files`/`list_code_definition_names`/`search_files`**. Robustness across all hydro file operations.
6. **v3.76.0 — repeated tool call loop detection**. Saves tokens/cost on every user.
7. **v3.71.0 — streamable HTTP MCP reconnect reliability**. AI-Hydro's MCP stack benefits directly.
8. **v3.74.0 — file read deduplication cache** + **v3.77.0 — chunked `read_file`**. Hydro datasets are large.
9. **v3.68.0 — yaml.load `JSON_SCHEMA` security fix** + **v3.41.0 — secrets.json restrictive permissions** + **v3.47.0 — expired token prevention**. Security cluster.
10. **v3.69.0 — git restore retry / `.git_disabled` cleanup** + **v3.41.0 — non-blocking initial checkpoint**. Checkpoint reliability on large repos.

---

## Conflict Heatmap (where ports will fight AI-Hydro's fork)

**High conflict — expect manual merging:**
- `webview-ui/src/components/chat/` — banner carousel, error rows, thinking/reasoning UI, feature tips, model picker tabs, slash command menu, Plan/Act tabs, task header, WhatsNew modal, error UI ("Spend Limit"/"Quota Exceeded"). Touched by v3.39, v3.40, v3.42, v3.43, v3.44.2, v3.46, v3.58, v3.63, v3.74, v3.76, v3.78, v3.80.
- `webview-ui/src/components/settings/` — settings refresh, feature toggles, focus-chain slider, reasoning-effort move, skills toggle removal, hooks toggle. v3.35, v3.56, v3.58, v3.67, v3.72, v3.77.
- `webview-ui/**/ClineRulesToggleModal*` (now `AiHydroRulesToggleModal`) — v3.74 padding change references the OLD name.
- `src/core/task/` — streaming, duplicate row prevention, state serialization, command_output ask, task export. v3.58, v3.70, v3.79, v3.38.3.
- `src/core/prompts/` (system prompt builders) — `use_subagents`, `new_task` removal, GLM/GPT-5 family prompts, parallel tool calling prompts, Hermes prompts, deep-planning. v3.35, v3.37, v3.38, v3.46, v3.47, v3.58, v3.79, v3.80.
- `src/core/controller/` and `src/services/` — anywhere typed against `AiHydroMessage`/`AiHydroAsk`/`AiHydroError`. Any rename/refactor in upstream `Cline*` types will need translation.
- `src/core/mcp/` — auto-sync remote MCP servers (v3.49) directly interacts with `ensureDefaultMcpServer.ts`. v3.44.1, v3.45.1, v3.55, v3.71.

**Medium conflict:**
- `src/api/providers/` — every provider addition/fix lands here. Most are additive but maxTokens metadata refactors (v3.46, v3.41, v3.68) touch shared shape.
- `src/integrations/terminal/` — foreground/background terminal mode flip-flop (v3.80 removed, v3.82 restored), exit codes, timeouts. v3.40, v3.46, v3.58, v3.80, v3.82.
- `src/integrations/checkpoints/` — git restore retry, `.git_disabled` cleanup, non-blocking initial commit. v3.41, v3.69.
- `src/services/auth/` — Cline-account auth changes are SKIP territory; OCA/ACP fixes may still apply. v3.40.2, v3.36.0, v3.67.0.

**Low conflict — likely clean cherry-pick:**
- `src/integrations/diagnostics/`, `src/utils/` — ripgrep, path utils, axios bumps.
- `src/api/transform/` — Anthropic content block sanitization (v3.38.1, v3.36.1, v3.79).
- `src/services/yaml/` (or wherever yaml.load lives) — security fix.
- `src/integrations/notebook/` (Jupyter) — additive (v3.52, v3.54).
- `src/services/proxy/` and HTTP proxy handling — additive (v3.37, v3.36, v3.43).
- Dependency version bumps in `package.json` lockfiles.

**Files to grep for conflict pre-flight:**
- Any import of `ClineMessage`, `ClineAsk`, `ClineSay`, `ClineError`, `ClineAccountService`, `ClineRulesToggleModal`, `globalClineRulesToggles`, `.clinerules`, `.clineignore` outside `src/shared/proto/cline/` and `src/generated/` — those are AI-Hydro rename frontiers.
- Anywhere `cline.*` VS Code config keys appear in upstream patches — need rewrite to `aihydro.*`.
- `aihydro_mcp_settings.json` vs upstream `cline_mcp_settings.json` paths.
