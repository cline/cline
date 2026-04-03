# SDK Migration Project

Our goal is to radically simplify the Cline VSCode extension and Cline
JetBrains plugin so that they all use the Cline SDK instead of the
"classic" Cline core. This document describes the project in detail.

## References

### Code References

Cline SDK is at ~/clients/cline/sdk-wip
Cline (core, classic VSCode extension, CLI) is at ~/clients/cline/cline
JetBrains Plugin is at ~/clients/cline/intellij-plugin
IntelliJ open source reference is at ~/clients/cline/intellij-community
JCEF (Java-Chromium embedded framework reference) is at ~/clients/cline/jcef

You can use kb_search with these identifiers to understand the
existing code and the SDK code:

cline - Cline core, classic VSCode extension, CLI
sdk - Cline SDK
plugin - JetBrains plugin
vscode - Visual Studio Code opens source
ij - IntelliJ open source
jcef - JCEF IntelliJ's embedded Chromium layer

Prototype VSCode extension on SDK is at ~/clients/cline/sdk-vscode-sample
Prototype JetBrains plugin on SDK is at ~/clients/cline/sdk-intellij-plugin-sample

These are prototypes with features missing and added, so refer to them
as examples, but don't overindex on them.

### Documentation references

See the ~/clients/cline/cline/docs for extension product documentation
and ~/clients/cline/sdk-wip/*.md for SDK documentation.

### Background on the products & architecture

There's a VSCode extension in cline/src. A large part of its UI is a
React-based webview in cline/webview-ui.

There's a JetBrains plugin in the intellij-plugin repo. It packages
the core of the VSCode extension, including the webview, and
communicates with it with protobufs. There's a bunch of stuff in the
cline repo called "standalone" which is what JetBrains communicates
with.

In cline/cli there's a CLI and Kanban tool. Those use the SDK/are
being ported separately to the SDK, so you don't need to worry about
them. It is OK if you have to break them. Just ignore them.

Note, there was an earlier, failed attempt at a cli in go. The go cli
used to use "standalone" like JetBrains. If there's any old go support
cluttering up the repo, it is fine to delete it and clean it up.

The source code and docs mentioned above are the best reference to the
product architecture, behavior, etc. Feel free to ask clarifying
questions when necessary.

## Features

These product decisions are from our product and executive leadership:

### Features to remove

Terminal integration: There is legacy code in the VSCode extension,
and stubs in the RPC system for JetBrains, which used the IDE's
integrated terminals. We have decided we don't need these old modes
and they should be removed. Instead we will rely on "background
terminal". This literally means the node code forks and execs a shell
and uses pipes to communicate with it.

Browser automation: Remove the system that uses Playwright to automate
browsers. These use cases are now well served by third-party MCP
tools.

"Shadow git" checkpointing system. This is too slow, especially on
Windows. The way the Kanban project uses the existing git repo to
store references, and only after each user message, is better. So we
will drop the "shadow copy" git checkpointing system.

Memory bank, structured context: multi-file documentation
(projectbrief, productContext, activeContext, systemPatterns,
techContext, progress.)

Memory bank, persistence: cross-session context preservation.

Focus chain, task tracking: Auto-generated to-do list with real-time
progress indicators.

Focus chain, integration: Editable focus chain integration with deep
planning and reminders.

Deep planning exploration, output and the /deep-planning command.

Workflows (definition, natural language + XML tool syntax, MCP tools
and user input prompts) ... these have been superceded by SKILLS
moving forward.

Slash commands no longer necessary:

/deep-planning (codebase investigation + plan... we have plan/act mode)
/reportbug (bug reporting with diagnostics)
Custom workflows (/workflow.md for user-defined workflows... we have "skills" now.)

### Core features

These must work:

File operations: read, write, search, replace, list files, inspect
code definitions (functions, classes, methods)

Terminal integration: "Background terminal" must work. The agent
relies on this to run npm, git, docker, etc.

Multi-provider AI models: 30+ providers with seamless
switching. There's one provider of note: VSCode has a provider which
hooks up to Copilot using the VSCode LM Provider API. It would be good
to support this *if possible.*

Auto-approve & YOLO mode
- Granular per-tool permission controls
- YOLO mode for maximum automation
- Monitoring, notifications for long-running commands

Auto-compaction
- Summarization automatically compresses conversations when context fills
- Model support for Claude, Gemini, GPT-5, Grok, etc.

Subagents
- Parallel execution of independent research agents
- Isolation with separate context windows
- Cost tracking for task usage per subagent

Web search and web fetch

Worktrees
- git worktrees for parallel sessions
- branch management and .worktreeinclude support
- conflict resolution and merging

Workspaces
- "multi-root" workspaces/projects with multiple root folders
- @workspace:path scoped references

Jupyter Notebooks
- Generate, explain, and improve notebook cells

Cline Rules
- project-specific .cline/rules and global instructions.
- Conditional logic: Path-based activation of rules.
- Compatibility: Works with Cursor Rules, Windsurf rules, AGENTS.md

Skills
- SKILL.md format with YAML frontmatter
- Loading levels: Metadata, instructions and resources
- Scope: Global and project-specific; toggleable

Hooks
- Events: Task lifecycle + tool events (TaskStart, PreToolUse, etc.)
- Runtimes: bash, powershell for Windows
- IO: JSON
- Context injection: Be able to modify or inject context dynamically

.clineignore
- Exclusion rules, gitignore-style file/directory exclusion
- Exceptions: ! prefix for overrides
- Override behavior: Explicit @ mentions bypass ignore rules

MCP (Model Context Protocol)
- Server management: Discovery, enable/disable, restart, config editing
- Transport: stdio (local) and SSE (remote)
- ...all the typical use cases for MCP: APIs, browser automation, db queries, etc.

### Core workflows

These must work:

Task Management

Task lifecycle - create and resume tasks; view task history
Cost tracking - token using and cost monitoring per task

Plan & Act Mode
Plan mode - Explore and investigate without modifying files
Act mode - Implementation with approval gates
Model config - Separate model configuration for plan and act mode if
               the user desires
State persistence - Mode switching, task switching preserves history

File context (@-mentions)
Context referencing - Reference files, folders, terminal output, git
changes, URLs, commits via @

Slash commands
/newtask (new task)
/smol (compress history)
/newrule (create rules)

### Model Configuration

We want to continue supporting our 30+ providers (Anthropic, OpenAI,
OpenAI Codex, OpenRouter, Google Gemini, AWS Bedrock, DeepSeek,
Cerebras, Qwen, Mistral, Groq, Fireworks, Together, xAI Grok,
Moonshot, Nebius, HuggingFace, LiteLLM, Ollama, LM Studio, and more.)

THE MOST IMPORTANT REQUIREMENT HERE, after continuing to support them,
is to USE THE CREDENTIALS, MODEL NAMES, CONFIGS, etc. WE HAVE
SAVED. Logging people out of their providers is really annoying to
users; regenerating API keys is painful for them.

VSCode LM API provider may be an interesting/unusual provider out of
this set; it only works in VSCode by calling a specific API.

We must continue supporting local models like Ollama and LM Studio.

We must support the Cline provider with unified auth (open a
webbrowser, handle the SSO redirect), built-in billing and credit
display, banners advertising new or free models, stealth/early access
models, organization switching.

### Enterprise Features

Security and governance
- Client-side execution only (no data transmission outside of limited
  Telemetry and inference; no remote codebase indexing)
- SSO role-based access control (member, admin, owner)
- Model and tool controls per team
- Remote configuration downloaded and applied by the extension

Observability
- OpenTelemetry, Datadog, Grafana, Splunk integrations
- Real-time analytics, cost breakdown by team, selective audit logging

Infrastructure
- AWS Bedrock, Google Vertex AI, Azure OpenAI integration
- Bring-your-own-inference with custom endpoints

### Priority "P1" (mid priority) items

These are nice to have but can be done as follow-ups if convenient:

Checkpoints - automatic file snapshots after each change. Note, the
snapshot system in the VSCode extension and JetBrains plugin which
copies the whole repository is slow, *especially on Windows*, so we
should replace it with one that writes refs directly into the local
git repo. Look at the way the kanban project does it; this is
preferred (and maybe we should extract and share this code.)

Diffing - compare changes between checkpoints

Restore - restore files, task to a point, or both

MCP Marketplace - we could get rid of this, but ultimately we do want
this feature with major improvements like allowing remote install. For
now, consider removing it, but if it is easier to keep it around let's
do that to lay the groundwork for improvements.

### Priority "P2" (lower priority) items

These can be done later if necessary, or are negotiable if they are complicated:

Task organization - favorites for task grouping and management

File context - Drag and drop files to add to context
File context - actions - context menus to add to Cline, fix, explain, improve

Slash commands
/explain-changes (git diff explanation)

## Detailed Design

### Naming: "Sdk..." considered harmful

Do not name types "SdkFoo" or folders "sdk". If you need to use SdkFoo
as a way to keep two classes around in parallel while you're porting,
that's OK, but when this project is done we want to have one clean,
simple codebase; the SDK backing is an implementation detail so just
use simple noun phrases for classes, etc. and don't litter "Sdk" all
over identifiers and folders.

### Proto deprecation and removal

We don't need proto files to describe webview messages. The webview
and extension backend are both in TypeScript and are versioned and
shipped together. We just need to use shared TypeScript interfaces
between them.

We *also* don't need proto to describe JetBrains <--> node
exchanges. We just need something typed and in sync between Kotlin and
TypeScript that we can serialize. JSON probably makes sense. Protos
are OK but we have had problems with that setup creating a ton of GC
pressure on the Kotlin side, hit maximum message size limits, etc.

There are proto build steps which we can remove, as we use proto less.

protos are useful for state which is serialized. If there are files
that are persisted described by protos, it is ok/good to keep
them. Don't expand the use of protos to places protos are not already
used.

### Web View UI

The Webview UI is very dependent on state arising from implementation
details of the pre-SDK implementation. At the same time, we don't want
to build a new UI from scratch right now because it may be forcing too
many changes upon our users at once. So we aim to reuse the existing
webview, but with radical simplificiation in its state management now
that we will have a cleaner architecture in the extension "backend"
with the layering enforced by the SDK.

The webview UI had defects like showing the wrong keybindings for
JetBrains, or using tons of memory or CPU cycles by spamming state
updates really rapidly or sending n^2 state updates as they streamed
in. The first principle of this migration to the SDK is not get worse,
but at the same time, we expect the state clean-up necessary in the
webview will lead to radical simplifications which make some
low-hanging fruit available in performance. It's great to go make
those improvements where they are available.

We don't need this UI to be pixel perfect identical. We need it to be
FAMILIAR, NOT WORSE and preferably BETTER than the status quo.

### Data formats, settings

We MUST pick up existing on-disk state for settings, etc. We don't
want to log users out of their inference providers as we make this
change to the SDK.

The CLI, VSCode extension and JetBrains extension largely share state
on disk. We should continue that situation. If data migrations are
necessary, that's fine, but design them with care. In particular, we
want the long term to be fast, so we should write breadcrumbs
indicating when migration is done. In addition, users can upgrade and
downgrade their extension versions, etc. and we want to be robust to
that in addition to all kinds of failures. For example, in the past we
had problems where we overwrote a JSON settings file, perhaps racily,
and left trailing }s in the file and this caused the product to
totally fail. That's a very serious issue for our users so pay extra
effort and attention to what is happening on disk. (We want PRACTICAL
solutions and robustness and not performative solutions that just add
tons of code and complexity with no real benefit.)

Invalidating old checkpoints is acceptable, unless it is particularly
cheap to support the classic checkpoints. We won't be authoring those
checkpoints any more, and it would be heavy to migrate them.

We want to move from .clinerules (old style) to .cline/rules (new style.)

### Telemetry

We generally want to continue sending the same Telemetry events. If
that is hard, make a detailed report and we can follow up with our
backend team. Note some enterprise features depend on OTEL
observability.

### Code Sharing

In general we should share code between IDEs where there are benefits
to do so. However trivial tools, or tools specific to a given IDE, can
be wired up directly from the extension through to the SDK. (This is
something that was hard to do in the old architecture and we would
like to make easier.)

## Questions

Does the SDK design support integrating the VSCode LM Provider API in
the VSCode extension? What changes, if any, do we need in the SDK to
support this inference provider?

**Answer**: Yes. The SDK's `@clinebot/llms` package has a custom
handler registry with `registerHandler("vscode-lm", factory)` —
the docs even use VSCode LM as the example. The VSCode extension
would register a handler factory at startup that wraps the
`vscode.lm` API. No SDK changes needed.

---

## Research Findings

### SDK Session Backend Extensibility

**Question**: Does the SDK's `SessionBackend` interface support
storing arbitrary per-task data (e.g., tool settings, hook
configuration, auto-approve preferences per task)?

**Answer**: Partially. The `SessionRow` has a `metadata:
Record<string, unknown> | null` field that can store arbitrary
key-value data per session. This is sufficient for per-task settings
like auto-approve preferences, tool configuration, etc.

The SDK supports three backend implementations:
1. `SqliteSessionStore` — SQLite-backed (default, preferred)
2. `FileSessionService` — JSON file-backed (fallback when SQLite
   unavailable)
3. `RpcCoreSessionService` — delegates to an RPC server

For our migration, we'll use either `FileSessionService` or provide a
custom `SessionPersistenceAdapter` that reads/writes our existing task
history format. The `ClineCoreOptions.sessionService` field accepts
any backend implementing `CoreSessionService | RpcCoreSessionService |
FileSessionService`.

**Key finding**: The `SessionPersistenceAdapter` interface is the
cleanest extension point. It requires implementing: `ensureSessionsDir`,
`upsertSession`, `getSession`, `listSessions`, `updateSession`,
`deleteSession`, `enqueueSpawnRequest`, `claimSpawnRequest`. Our
`LegacySessionBackend` adapter wraps the existing
`~/.cline/data/tasks/` directory and `taskHistory` JSON array in
`globalState.json`, mapping between `SessionRow` fields and our
`HistoryItem` type:

```
HistoryItem.id          → SessionRow.sessionId
HistoryItem.ts          → SessionRow.startedAt (ISO string)
HistoryItem.task        → SessionRow.prompt
HistoryItem.tokensIn    → metadata.tokensIn
HistoryItem.tokensOut   → metadata.tokensOut
HistoryItem.totalCost   → metadata.totalCost
HistoryItem.modelId     → SessionRow.model
HistoryItem.isFavorited → metadata.isFavorited
```

Per-task files (`api_conversation_history.json`, `ui_messages.json`)
map to `SessionRow.messagesPath` and `SessionRow.transcriptPath`.

**Decision**: We will provide a custom `SessionPersistenceAdapter`
that translates between our existing format and the SDK's interface.
No need for a separate sidecar storage layer. The `metadata` field
handles all per-task extensions.

### Telemetry Event Mapping

The extension currently emits telemetry events via a PostHog-based
`TelemetryService`. The SDK has its own `TelemetryService` with
pluggable adapters (`OpenTelemetryAdapter`, `LoggerTelemetryAdapter`).

**Mapping of current extension events → SDK events:**

| Extension Event | SDK CORE_TELEMETRY_EVENTS | Notes |
|---|---|---|
| `user.extension_activated` | `CLIENT.STARTED` ("extension.activated") | ✅ Same event name |
| `user.auth_started` | `USER.AUTH_STARTED` | ✅ Direct match |
| `user.auth_succeeded` | `USER.AUTH_SUCCEEDED` | ✅ Direct match |
| `user.auth_failed` | `USER.AUTH_FAILED` | ✅ Direct match |
| `user.auth_logged_out` | `USER.AUTH_LOGGED_OUT` | ✅ Direct match |
| `task.created` | `TASK.CREATED` | ✅ Direct match |
| `task.restarted` | `TASK.RESTARTED` | ✅ Direct match |
| `task.completed` | `TASK.COMPLETED` | ✅ Direct match |
| `task.conversation_turn` | `TASK.CONVERSATION_TURN` | ✅ Direct match |
| `task.tokens` | `TASK.TOKEN_USAGE` | ✅ Direct match |
| `task.mode` | `TASK.MODE_SWITCH` | ✅ Direct match |
| `task.tool_used` | `TASK.TOOL_USED` | ✅ Direct match |
| `task.skill_used` | `TASK.SKILL_USED` | ✅ Direct match |
| `task.diff_edit_failed` | `TASK.DIFF_EDIT_FAILED` | ✅ Direct match |
| `task.provider_api_error` | `TASK.PROVIDER_API_ERROR` | ✅ Direct match |
| `task.mention_used` | `TASK.MENTION_USED` | ✅ Direct match |
| `task.mention_failed` | `TASK.MENTION_FAILED` | ✅ Direct match |
| `task.mention_search_results` | `TASK.MENTION_SEARCH_RESULTS` | ✅ Direct match |
| `task.subagent_started` | `TASK.SUBAGENT_STARTED` | ✅ Direct match |
| `task.subagent_completed` | `TASK.SUBAGENT_COMPLETED` | ✅ Direct match |
| `hooks.discovery_completed` | `HOOKS.DISCOVERY_COMPLETED` | ✅ Direct match |
| `session.started` | `SESSION.STARTED` | ✅ Direct match |
| `session.ended` | `SESSION.ENDED` | ✅ Direct match |

**Extension events with NO SDK equivalent (need adapter-layer emit):**

| Extension Event | Action |
|---|---|
| `user.opt_out` / `user.opt_in` | Emit via SDK's `captureRequired()` |
| `user.telemetry_enabled` | Emit via SDK's `capture()` |
| `user.extension_storage_error` | Emit via SDK's `capture()` |
| `user.onboarding_progress` | Emit via SDK's `capture()` |
| `workspace.*` (initialized, vcs_detected, etc.) | Emit via SDK's `capture()` |
| `task.feedback` | Emit via SDK's `capture()` |
| `task.option_selected` / `task.options_ignored` | Emit via SDK's `capture()` |
| `task.checkpoint_used` | Emit via SDK's `capture()` |
| `task.mcp_tool_called` | Emit via SDK's `capture()` |
| `task.historical_loaded` | Emit via SDK's `capture()` |
| `task.retry_clicked` | Emit via SDK's `capture()` |
| `task.slash_command_used` | Emit via SDK's `capture()` |
| `task.feature_toggled` | Emit via SDK's `capture()` |
| `task.rule_toggled` | Emit via SDK's `capture()` |
| `task.auto_condense_toggled` | Emit via SDK's `capture()` |
| `task.yolo_mode_toggled` | Emit via SDK's `capture()` |
| `task.terminal_*` (execution, output_failure, hang) | Emit via SDK's `capture()` |
| `task.initialization` | Emit via SDK's `capture()` |
| `task.summarize_task` | Emit via SDK's `capture()` |
| `ui.*` (model_selected, button_clicked, etc.) | Emit via SDK's `capture()` |
| `hooks.enabled` / `hooks.disabled` | Emit via SDK's `capture()` |
| `hooks.cancel_requested` | Emit via SDK's `capture()` |
| `hooks.context_modified` | Emit via SDK's `capture()` |
| `worktree.*` | Emit via SDK's `capture()` |
| `host.detected` | Emit via SDK's `capture()` |

**Extension events being REMOVED (features deleted):**

| Extension Event | Reason |
|---|---|
| `task.browser_tool_start/end/error` | Browser automation removed |
| `task.focus_chain_*` (6 events) | Focus chain removed |
| `task.workspace_search_pattern` | Folded into SDK search |
| `task.subagent_enabled/disabled` | Toggle events; SDK manages directly |
| `task.cline_web_tools_toggled` | Feature simplified |
| `cline.grpc.response.size_bytes` | gRPC being removed |

**Metrics (OTEL counters/histograms):**

The extension has ~30 OTEL metrics (`cline.turns.total`,
`cline.tokens.input.total`, `cline.api.ttft.seconds`, etc.). The SDK
telemetry service supports `recordCounter`, `recordHistogram`, and
`recordGauge`. We will emit these same metrics from the adapter layer
using `telemetry.recordCounter()` / `telemetry.recordHistogram()`.
The metric names can stay the same.

**Decision**: The SDK's `ITelemetryService.capture()` is a generic
event emitter — we can emit ALL extension events through it. The
adapter layer will create a thin telemetry wrapper that provides
the same `captureTaskCreated()`, `captureToolUsage()`, etc. methods
but delegates to the SDK's telemetry service. Events where the SDK
already has a helper function (listed in the first table) use those
directly. Others use `capture({ event, properties })`. No backend
team coordination needed for the initial migration.

### JetBrains IPC Design

#### Current Architecture

```
┌── Kotlin Plugin ──────────────────────────────┐
│                                                │
│  CoreProcessManager                            │
│    └─ launches Node.js process (cline-core)    │
│    └─ communicates via gRPC ProtoBus           │
│       (port 26040-26340)                       │
│                                                │
│  HostBridgeService (gRPC server, port 26041)   │
│    ├─ DiffService                              │
│    ├─ WindowService (show file, open dialog)   │
│    ├─ WorkspaceService (paths, diagnostics)    │
│    ├─ EnvService                               │
│    └─ TestingService (get webview HTML)         │
│                                                │
│  ProtoBusProxyService                          │
│    └─ proxies webview ↔ cline-core gRPC        │
│                                                │
│  JsPostMessageHandler                          │
│    └─ injects JS bridge into JCEF webview      │
│    └─ converts postMessage → gRPC request      │
│                                                │
│  WebViewManager                                │
│    └─ loads webview HTML in JCEF                │
│    └─ receives gRPC responses → postMessage    │
└────────────────────────────────────────────────┘
```

Problems with this architecture:
- **Proto size limits**: gRPC messages hit 256MB limits with large
  conversations. The `ProtoBusProxyService` logs warnings at 10MB+.
- **Java heap pressure**: Serializing/deserializing large proto
  messages stresses the JVM heap.
- **Build complexity**: Proto compilation required for both
  TypeScript and Java/Kotlin.
- **Stateless-in-theory**: The design is somewhat stateless but we
  haven't leveraged restart-for-reliability because state
  reconstruction is expensive.

#### Target Architecture

```
┌── Kotlin Plugin ──────────────────────────────┐
│                                                │
│  CoreProcessManager                            │
│    └─ launches SDK sidecar (Node.js)           │
│    └─ communicates via JSON-RPC over stdio     │
│                                                │
│  HostCallbackService (JSON-RPC server)         │
│    ├─ showTextDocument, openDialog             │
│    ├─ getWorkspacePaths, getDiagnostics        │
│    ├─ getEnvVars, clipboard                    │
│    └─ (extensible for PSI, run configs, etc.)  │
│                                                │
│  WebviewBridge                                 │
│    └─ receives JSON messages from sidecar      │
│    └─ forwards to JCEF via executeJavaScript   │
│    └─ receives postMessage from JCEF           │
│    └─ forwards to sidecar via stdio            │
│                                                │
│  WebViewManager                                │
│    └─ loads adapted webview in JCEF            │
└────────────────────────────────────────────────┘

┌── SDK Sidecar (Node.js) ──────────────────────┐
│                                                │
│  SidecarMain                                   │
│    └─ JSON-RPC over stdio (bidirectional)      │
│    └─ imports @clinebot/core                   │
│    └─ shares SDK adapter layer with VSCode     │
│                                                │
│  ClineCore instance                            │
│    └─ session management                       │
│    └─ tool execution                           │
│    └─ provider handling                        │
│                                                │
│  HostCallbackClient                            │
│    └─ calls back to Kotlin for IDE ops         │
│    └─ registered as tool executors in SDK      │
│                                                │
│  WebviewBridge                                 │
│    └─ translates SDK events → webview messages │
│    └─ same code as VSCode adapter              │
└────────────────────────────────────────────────┘
```

#### IPC Mechanism: JSON-RPC over stdio

**Why JSON-RPC over stdio instead of gRPC:**
- **No message size limits**: JSON over stdio has no inherent size
  cap. Conversations with 100K+ tokens serialize to ~5-20MB JSON
  which flows fine over pipes.
- **No heap pressure**: No proto serialization on the Java side.
  Kotlin reads/writes JSON strings directly. JCEF already works
  with JSON.
- **No proto compilation**: Eliminates the Java protobuf dependency
  and the dual TypeScript/Java proto generation step.
- **Simple**: Well-understood protocol. Easy to debug (just read
  the pipe).

**Protocol**: JSON-RPC 2.0 over stdin/stdout with newline-delimited
JSON messages. The sidecar reads from stdin and writes to stdout.
Stderr is reserved for logging.

```
→ {"jsonrpc":"2.0","method":"session/start","params":{...},"id":1}
← {"jsonrpc":"2.0","result":{"sessionId":"..."},"id":1}
← {"jsonrpc":"2.0","method":"webview/message","params":{"type":"assistant_delta","text":"..."}}
```

**Notifications** (no `id`) are used for streaming events
(assistant deltas, tool events, state updates). The Kotlin plugin
processes these and forwards them to the JCEF webview.

**Callbacks** from sidecar → Kotlin (host operations) use
JSON-RPC requests in the reverse direction:

```
← {"jsonrpc":"2.0","method":"host/showTextDocument","params":{"path":"..."},"id":100}
→ {"jsonrpc":"2.0","result":{"success":true},"id":100}
```

#### Code Sharing Between VSCode, JetBrains, and CLI

The shared SDK adapter layer (`src/sdk-adapter/`) contains:

```
src/sdk-adapter/
  index.ts              — ClineSdkHost (creates ClineCore instance)
  session-backend.ts    — LegacySessionBackend adapter
  webview-bridge.ts     — SDK events → webview message translation
  provider-migration.ts — Legacy provider settings migration
  approval-adapter.ts   — Auto-approve settings → SDK tool policies
  telemetry-adapter.ts  — Extension telemetry → SDK telemetry
  types.ts              — WebviewInbound, WebviewOutbound types
```

Each host then has a thin integration layer:

- **VSCode** (`src/hosts/vscode/sdk-extension.ts`): In-process.
  Creates `ClineSdkHost`, registers VSCode LM handler, manages
  webview lifecycle. Uses `postMessage` for webview communication.

- **JetBrains** (`src/sidecar/main.ts`): Separate process. Creates
  `ClineSdkHost`, reads/writes JSON-RPC on stdio. Registers
  `HostCallbackClient` for IDE operations. The webview bridge code
  is identical — it just sends messages over stdio instead of
  `postMessage`.

#### Statefulness and Reliability

The sidecar is **stateful** — it holds the `ClineCore` instance with
active sessions in memory. However, it is designed for **graceful
restart**:

- **Session persistence**: All session state is written to disk
  after each turn (messages, manifest, transcript). On restart, the
  sidecar re-reads the session index and can resume.
- **Crash detection**: The Kotlin plugin monitors the sidecar
  process. If it exits unexpectedly, the plugin restarts it after a
  brief delay (same as current `CoreProcessManager.RESTART_DELAY`).
- **Smaller messages**: Because the protocol is JSON-RPC with
  incremental streaming (notifications for each delta), the
  messages are much smaller than the current gRPC approach which
  sends full state snapshots. This eliminates the heap pressure
  that made the current system unreliable.
- **Interrupted operations**: If the sidecar crashes mid-turn, the
  next startup detects the unfinished session (status = "running"
  but no live process) and marks it as interrupted, just like the
  current task resumption flow.

#### JetBrains-Specific Tools

The HostCallback pattern makes it easy to add JetBrains-specific
capabilities without changing shared code:

1. **Registration**: The sidecar's `HostCallbackClient` declares
   what capabilities the host supports (e.g., `"psi"`, `"runConfigs"`).
2. **Tool Executors**: JetBrains-specific tool executors are
   registered in `ClineCoreOptions.defaultToolExecutors` when the
   sidecar starts. For example, a `getDiagnostics` executor that
   calls `host/getDiagnostics` via JSON-RPC to get IntelliJ's PSI
   analysis results.
3. **No shared code changes**: Adding a new JetBrains capability
   requires:
   - Implementing the handler in Kotlin (`HostCallbackService`)
   - Adding a JSON-RPC method in the sidecar's `HostCallbackClient`
   - Optionally registering a custom tool executor

Example for exposing JetBrains PSI:
```kotlin
// Kotlin side
"host/getPsiStructure" -> {
    val file = PsiManager.getInstance(project).findFile(virtualFile)
    // ... extract structure
    respondWithJson(result)
}
```
```typescript
// Sidecar side - registered as a custom tool executor
defaultToolExecutors: {
  list_code_definition_names: async (args) => {
    // Call back to JetBrains for richer PSI-based results
    const result = await hostCallback.call("host/getPsiStructure", { path: args.path });
    return result;
  }
}
```

---

## Retrospective: What Went Wrong on `sdk-migration-port-check`

### Summary of Current State

The branch deleted ~138K lines (classic core, proto, gRPC) and added
~5.5K lines (SDK adapter layer + stub webview). The result:

- **595 TypeScript errors** — the build is broken because `src/core/`
  was deleted before updating all consumers (utils/, cli/, tests all
  have dangling `@core/`, `@/hosts/`, `@shared/proto/` imports).
- **Zero tests** for the new SDK adapter code (SdkController,
  message-translator, state-builder, legacy-state-reader,
  provider-migration, grpc-handler, event-bridge).
- **Stub webview created** — SdkApp.tsx, SdkChatRow.tsx,
  SdkSettingsView.tsx, SdkHistoryView.tsx are ~1200 lines of new
  skeleton UI that doesn't look or function like the real product.
  The user can't pick a model, can't test chat, can't verify anything.
- **Two parallel message protocols** — the branch has BOTH a new SDK
  typed-message protocol (SdkStateContext.tsx + sdk-client.ts) AND a
  gRPC compatibility layer (grpc-handler.ts + state-builder.ts). The
  classic `main.tsx` still loads the original `App` component (not
  `SdkApp`), so the gRPC compat layer is what actually runs—but it
  stubs out most RPCs with no-ops or empty responses.
- **No observability for the agent** — no working test runner, no
  debugger setup, no way to evaluate what's happening at runtime.
  Debugging required adding console.logs, rebuilding, re-running
  manually, and removing logs. This is too slow.

### Root Causes

1. **Premature deletion**: Deleting `src/core/` before having a
   working replacement broke the build and all consumers at once,
   making it impossible to verify anything incrementally.

2. **Stub webview instead of adapting existing**: Creating new
   skeleton components (SdkChatRow, SdkSettingsView, etc.) means
   duplicating a massive, complex UI. The plan said "keep the
   existing webview" but the implementation went the other way. The
   stubs don't handle the hundreds of edge cases the real components
   handle.

3. **Undefined interface contract**: The boundary between extension
   backend and webview was not formally defined or tested. The
   `state-builder.ts` constructs a 200-field `ExtensionState` object
   with many `as any` casts and `as unknown as ExtensionState`. Any
   missing or wrong field causes silent UI failures.

4. **No test-first approach**: The SDK adapter layer is the most
   critical new code and has zero tests. The message-translator maps
   SDK events to ClineMessage[] with complex state management
   (streaming accumulation, tool call tracking, iteration counting)
   — all untested.

5. **No agent-accessible debugging**: The agent couldn't run the
   extension, set breakpoints, or evaluate expressions. It had no
   fast feedback loop. Manual testing by the user was blocked because
   the UI was non-functional.

### Lessons for the New Plan

- **Never delete old code before the replacement works.** Keep both
  running side-by-side. The old extension entry point stays as the
  default; the new one is activated by a flag.
- **Don't create stub UI components.** Adapt the existing webview
  by making the backend speak its language, not vice-versa.
- **Define and test the interface contract first.** The
  extension↔webview boundary must have formal types, snapshot tests,
  and unit tests before wiring it up.
- **Build observability before building features.** The agent needs
  to be able to run the extension, inspect state, and run targeted
  tests without human intervention.

---

## Migration Plan (Revised)

### Decisions

These decisions were made during planning discussions:

- **Webview communication**: Big-bang replacement of
  gRPC-over-postMessage with simple typed messages. These messages
  are ephemeral (not an on-disk format), so if it goes wrong we can
  revert and retry.

  These "simple typed messages" should be JSON-serializable messages
  described by TypeScript types.

- **JetBrains sidecar**: New lightweight Node.js entry point (NOT
  `clite`) that imports `@clinebot/core`. Shares the SDK adapter
  layer with the VSCode extension. Uses JSON-RPC over stdio
  instead of gRPC ProtoBus. See "JetBrains IPC Design" section
  above for full details on IPC mechanism, code sharing,
  statefulness, and extensibility.

- **SDK packaging**: Published npm packages. Use `npm link` for
  local development when SDK changes are needed.

- **Rollout order**: VSCode first (from a branch). JetBrains
  currently imports this repo as a submodule, so we can ship the
  updated extension from a branch while main continues shipping
  the classic extension.

- **Webview approach**: Keep the existing webview-ui codebase. Delete
  things we no longer need and simplify state management. Do NOT
  build a new UI from scratch or port the SDK sample UI.

- **Breaking changes**: Avoid where possible. Only introduce new
  on-disk formats where there's a strong reason, since the features
  are similar and files should be the same or compatible.

- **Session persistence**: Do NOT use the SDK's SQLite session
  storage backend for now. We need existing sessions to be resumable
  using the current JSON-based task history format. The SDK's
  `DefaultSessionManager` accepts an injectable `sessionService`
  backend, so we will provide a custom adapter that reads/writes our
  existing format (`~/.cline/data/tasks/`).

- **Task history**: Continue using the existing JSON-based task
  history. New sessions write in the same format so old and new
  sessions are seamlessly intermixed in the history view.

### Architecture Overview

#### Current Architecture
```
┌─── VSCode Extension ──┐  ┌── JetBrains Plugin ──┐  ┌──── CLI ────┐
│  WebviewProvider       │  │  Kotlin Plugin       │  │  React Ink  │
│  Controller            │  │  CoreProcessManager  │  │  ClineAgent │
│  Task                  │  │  ProtoBusProxy       │  │             │
│  API providers (30+)   │  │  JCEF WebView        │  │             │
│  McpHub                │  │                      │  │             │
│  Webview (React)       │  │  ↓ gRPC              │  │             │
│                        │  │  cline-core           │  │             │
│  proto/cline/*.proto   │  │  (standalone Node)    │  │             │
└────────────────────────┘  └──────────────────────┘  └─────────────┘
```

#### Target Architecture
```
┌─── VSCode Extension ──┐  ┌── JetBrains Plugin ──┐  ┌──── CLI ────┐
│  SDK Adapter Layer     │  │  Kotlin Plugin       │  │  React Ink  │
│  @clinebot/core        │  │                      │  │  TUI        │
│  (in-process)          │  │  ↓ JSON-RPC/stdio    │  │             │
│  Webview (adapted)     │  │  SDK sidecar (Node)  │  │             │
│                        │  │  @clinebot/core      │  │             │
│  registerHandler       │  │                      │  │             │
│  ("vscode-lm", ...)   │  │  Webview (adapted)    │  │             │
└────────────────────────┘  └──────────────────────┘  └─────────────┘

All clients backed by:
  @clinebot/core → @clinebot/agents → @clinebot/llms
       ↓                  ↓                   ↓
    Sessions          Tools/Hooks        Providers
    Storage           MCP Bridge         Model Catalog
    Telemetry         Teams/Spawn        Handler Registry
```

### What the SDK Already Provides

These capabilities exist in the SDK and do not need to be rebuilt:

1. **Legacy provider settings migration** —
   `migrateLegacyProviderSettings()` reads `globalState.json` +
   `secrets.json`, writes to `providers.json`. Handles Anthropic,
   OpenAI, OpenAI Codex OAuth, OpenRouter, Bedrock, custom
   OpenAI-compatible endpoints, etc. Existing providers are never
   overwritten. Migrated entries are tagged `tokenSource: "migration"`.

2. **30+ provider handlers** — Anthropic, OpenAI (chat + responses
   API), Google Gemini, AWS Bedrock, Vertex AI, DeepSeek, Ollama,
   LM Studio, Mistral, Groq, Fireworks, Together, xAI, Cerebras,
   LiteLLM, Nebius, HuggingFace, and more.

3. **Custom handler registry** — `registerHandler(id, factory)` and
   `registerAsyncHandler(id, factory)` for providers that need
   host-specific dependencies (e.g., VSCode LM API).

4. **MCP management** — `InMemoryMcpManager` with stdio, SSE, and
   streamableHttp transports. Config loader reads from
   `~/.cline/data/settings/mcp.json` with Zod validation. Supports
   legacy format migration.

5. **Tool framework** — 8 built-in tools: `read_files`,
   `search_codebase`, `run_commands`, `editor`, `apply_patch`,
   `fetch_web_content`, `skills`, `ask_question`. Preset system with
   `development` (act mode) and `readonly` (plan mode) presets.
   Per-tool enable/disable. Policy-based approval (auto-approve,
   require-approval, per-tool overrides). Model-aware tool routing
   (e.g., OpenAI models use `apply_patch` instead of `editor`).

6. **Session lifecycle** — `ClineCore.create()` → `host.start()` /
   `host.send()` / `host.abort()` / `host.stop()` / `host.subscribe()`
   Interactive mode with prompt queueing (`queue`/`steer` delivery).
   Event subscription for streaming.

7. **Telemetry** — `TelemetryService` with pluggable adapters:
   `OpenTelemetryAdapter` (for enterprise OTEL), `LoggerTelemetryAdapter`.
   Standard events: `session.started`, `session.ended`,
   `task.created`, `task.conversation_turn`, `task.tool_used`, etc.
   See "Telemetry Event Mapping" in Research Findings for full mapping.

8. **Rules & Skills** — Discovery from `.clinerules/`,
   `~/Documents/Cline/Rules`, `~/.cline/data/settings/rules/`.
   SKILL.md format with YAML frontmatter. Global and project scopes.

9. **Hooks** — `HookEngine` with lifecycle events. Node subprocess
   hook helpers for bash/powershell execution.

10. **Subagents/Teams** — `AgentTeamsRuntime`, spawn tools, team
    coordination with concurrent teammate agents.

11. **System prompt generation** — `getClineDefaultSystemPrompt()`
    with platform-aware customization.

12. **OAuth token management** — `RuntimeOAuthTokenManager` handles
    automatic token refresh during sessions for OAuth providers
    (Cline, OpenAI Codex).

13. **Storage isolation** — `CLINE_DIR`, `CLINE_DATA_DIR`,
    `CLINE_SESSION_DATA_DIR` environment variables plus
    `setClineDir()` / `setHomeDir()` APIs for test isolation.

### What Needs to Be Built/Adapted

1. **SDK Adapter Layer** — Bridge between SDK session events and
   existing webview message format. Manages SDK lifecycle within
   each host (VSCode in-process, JetBrains sidecar).

2. **Custom Session Backend** — Adapter implementing the SDK's
   `SessionPersistenceAdapter` interface that reads/writes our
   existing JSON-based task history format for backward compatibility.

3. **VSCode LM Handler** — Port existing `vscode-lm` provider
   handler code, register via SDK's `registerHandler()`.

4. **Cline Provider OAuth** — Port WorkOS SSO flow for the Cline
   provider. Integrate with SDK's `ProviderSettingsManager` for
   credential storage.

5. **Plan/Act Mode UX** — SDK has tool presets (`readonly` vs
   `development`) but the mode-switching UX (toggle, separate model
   configs per mode) needs to be wired in the adapter layer.

6. **Enterprise Features** — Remote config download/application, SSO
   role-based access, model/tool controls per team.

7. **Webview Simplification** — Replace gRPC-over-postMessage with
   typed messages; gut `ExtensionStateContext` subscriptions.

8. **Telemetry Adapter** — Thin wrapper that provides the same
   method signatures as the current `TelemetryService` but delegates
   to the SDK's telemetry service. Emits extension-specific events
   via `capture()` and maps core events to SDK helper functions.

9. **JetBrains Sidecar** — New Node.js entry point with JSON-RPC
   over stdio. Shares SDK adapter layer with VSCode.

### What Gets Deleted

1. `src/core/task/` — Replaced by `@clinebot/agents` agent loop
2. `src/core/controller/` — Replaced by SDK adapter layer
3. `src/core/api/` (30+ provider implementations) — Replaced by
   `@clinebot/llms`
4. `src/core/prompts/system-prompt/` — Replaced by SDK's
   `getClineDefaultSystemPrompt()`
5. `src/services/mcp/McpHub.ts` — Replaced by SDK MCP manager
6. `src/standalone/` — Replaced by SDK sidecar for JetBrains
7. `proto/cline/*.proto` (webview communication) — Replaced by
   typed message protocol
8. `src/shared/proto-conversions/` — No longer needed
9. `src/generated/` — No longer needed
10. Browser automation (Playwright integration)
11. IDE terminal integration (keep background terminal only)
12. Shadow git checkpoints
13. Memory bank / structured context
14. Focus chain
15. Deep planning / `/deep-planning` command
16. `/reportbug` command
17. Workflows system
18. Old Go CLI artifacts

### Phase -1: Close the visibility loop ✅

**Status**: Complete. See `visibility.md` for requirements.

**Tool**: `src/dev/debug-harness/server.ts` — HTTP-controlled debug
server that launches VSCode with the Cline extension and provides
programmatic access to the Node.js debugger, webview, and UI via CDP
and Playwright.

**Quick start:**
```bash
# Build (if needed):
npm run protos && IS_DEV=true node esbuild.mjs

# Launch:
npx tsx src/dev/debug-harness/server.ts --skip-build --auto-launch

# Use (from another terminal):
curl localhost:19229/api -d '{"method":"status"}'
curl localhost:19229/api -d '{"method":"ui.open_sidebar"}'
curl localhost:19229/api -d '{"method":"ui.screenshot"}'
curl localhost:19229/api -d '{"method":"ext.set_breakpoint","params":{"file":"src/extension.ts","line":42}}'
curl localhost:19229/api -d '{"method":"ext.evaluate","params":{"expression":"1+2"}}'
curl localhost:19229/api -d '{"method":"web.evaluate","params":{"expression":"document.title"}}'
```

**What works:**
- Extension host: breakpoints (sourcemap-resolved from original src
  files), evaluate expressions, step, pause/resume, call stack
  inspection — all via CDP over WebSocket
- Webview: evaluate expressions via Playwright `frame.evaluate()`;
  CDP breakpoints available after `connect_webview`
- UI automation: screenshots, open sidebar, click, fill, type,
  command palette, Playwright locators — all via Playwright Electron
- Sourcemap: 7916 source files indexed; `ext.set_breakpoint` maps
  e.g. `src/extension.ts:42` → `dist/extension.js:1136584`

**Caveats:**
- macOS only (Playwright Electron launch).
- Port 9230 must be free (extension host inspector).
- Scripts parsed before CDP connects aren't tracked (breakpoints
  still work via sourcemap).
- Webview CDP session may fail depending on Electron version;
  `web.evaluate` always works via Playwright fallback.

**References:** `.clinerules/debug-harness.md` (brief),
`src/dev/debug-harness/README.md` (full API docs).

### Phase 0: Preparation & Cleanup

**Goal**: Clear the decks, remove deprecated features, add SDK
dependency, verify build.

1. **Remove deprecated features** from current codebase:
   - Browser automation (Playwright)
   - IDE terminal integration (keep background terminal)
   - Shadow git checkpoints
   - Memory bank / structured context
   - Focus chain
   - Deep planning + `/deep-planning`
   - `/reportbug` command
   - Workflows system
   - Old Go CLI artifacts

2. **Add SDK npm dependencies**:
   - `@clinebot/core`
   - `@clinebot/agents`
   - `@clinebot/llms`
   - `@clinebot/shared`
   - Verify build compatibility, resolve any conflicts

3. **Telemetry mapping**: Document current events → SDK events,
   identify gaps, report to backend team if needed.
   (See "Telemetry Event Mapping" in Research Findings — this is
   now complete. No backend team coordination needed for initial
   migration.)

### Phase 1: VSCode Extension Backend

**Goal**: Replace Controller/Task/API layer with SDK. Webview still
works via a bridge.

1. **SDK Adapter Layer** (`src/sdk-adapter/`):

   - `ClineSdkHost` — Wraps `ClineCore.create({ backendMode:
     "local" })`. Manages session lifecycle. Holds the
     `SessionHost` instance.

   - `LegacySessionBackend` — Custom `SessionPersistenceAdapter`
     implementation that reads/writes our existing JSON-based task
     history format (`~/.cline/data/tasks/`). Maps between
     `SessionRow` and `HistoryItem`. Passed to
     `DefaultSessionManager` via the `sessionService` option.
     Uses `SessionRow.metadata` for extension-specific fields
     (tokensIn, tokensOut, totalCost, isFavorited).

   - `ProviderMigration` — Runs SDK's
     `migrateLegacyProviderSettings()` on first launch. Reads
     `globalState.json` + `secrets.json`, writes `providers.json`.
     Writes a sentinel to prevent re-migration. Robust to failures
     and version downgrades.

   - `VsCodeLmHandler` — Port existing VSCode LM handler. Register
     via `registerHandler("vscode-lm", factory)` at extension
     activation.

   - `ClineOAuthAdapter` — Port WorkOS SSO flow for Cline provider.
     Uses `ProviderSettingsManager.saveProviderSettings()` for
     credential persistence.

   - `ApprovalAdapter` — Map existing auto-approve settings to SDK
     tool policies (`Record<string, ToolPolicy>`).

   - `WebviewBridge` — Subscribes to SDK session events
     (`text_delta`, `tool_call_start`, `tool_call_end`,
     `reasoning_delta`, etc.) and translates them to the new
     webview message format.

   - `TelemetryAdapter` — Wraps SDK's `TelemetryService`. Provides
     the same capture methods as the current extension telemetry.
     Maps core events to SDK helpers; emits extension-specific
     events via `capture()`.

2. **New Controller**:
   - Uses `ClineCore.create()` in-process (no RPC sidecar for
     VSCode)
   - `host.start()` / `host.send()` / `host.abort()` /
     `host.stop()` / `host.subscribe()`
   - Manages webview lifecycle (sidebar + tab panel, same as
     current `WebviewProvider`)
   - Receives webview messages, dispatches to SDK

3. **Settings Migration**:
   - Detect existing `~/.cline/data/globalState.json` + `secrets.json`
   - Run `migrateLegacyProviderSettings()` → `providers.json`
   - Sentinel file prevents re-migration
   - Support both `.clinerules/` and `.cline/rules/` during
     transition

4. **MCP**: Replace `McpHub` with SDK's `InMemoryMcpManager` +
   `loadMcpConfigFromFile()`. Existing MCP settings file format is
   compatible with SDK's config loader.

### Phase 2: Webview Simplification

**Goal**: Big-bang replacement of gRPC-over-postMessage with simple
typed messages. Simplify state management, improve performance.

1. **New message protocol**:

   ```typescript
   // Inbound (webview → extension)
   type WebviewInbound =
     | { type: "ready" }
     | { type: "send"; prompt: string; images?: string[];
         files?: string[] }
     | { type: "abort" }
     | { type: "reset" }
     | { type: "loadModels"; providerId: string }
     | { type: "updateSetting"; key: string; value: unknown }
     | { type: "navigate"; view: string }
     | { type: "approveToolUse"; toolCallId: string;
         approved: boolean }
     // ... other actions as needed

   // Outbound (extension → webview)
   type WebviewOutbound =
     | { type: "state"; state: ExtensionState }
     | { type: "assistant_delta"; text: string }
     | { type: "reasoning_delta"; text: string;
         redacted?: boolean }
     | { type: "tool_event"; event: ToolEvent }
     | { type: "turn_done"; usage: Usage; finishReason: string }
     | { type: "providers"; providers: ProviderInfo[] }
     | { type: "models"; providerId: string;
         models: ModelInfo[] }
     | { type: "history"; items: HistoryItem[] }
     | { type: "status"; text: string }
     | { type: "error"; text: string }
     | { type: "session_started"; sessionId: string }
     | { type: "reset_done" }
     // ... other events as needed
   ```

2. **Simplify ExtensionStateContext**:
   - Remove all gRPC subscription boilerplate (~500+ lines of
     subscription setup)
   - Simple `useEffect` listening to `window.message` events
   - State comes from `type: "state"` full pushes + incremental
     deltas
   - Batch/debounce updates to fix the n² streaming performance
     issues

3. **Delete**:
   - `proto/cline/*.proto` (webview communication protos)
   - `src/shared/proto-conversions/`
   - `src/generated/` (generated proto code)
   - `scripts/build-proto.mjs` and related proto build scripts
   - Proto-based service clients in webview
   - UI components for deleted features: browser session, shadow
     checkpoints, memory bank, focus chain, deep planning,
     workflows

4. **Keep and adapt**:
   - ChatRow, ChatView — change data sources to new message types
   - Settings panels — wire to `updateSetting` messages
   - History view — reads from existing JSON task history
   - MCP panel, rules panel, skills panel — adapt data sources
   - Provider/model selection UI

### Phase 3: Delete Classic Core

**Goal**: Remove old backend code now that SDK adapter is working.

1. Delete `src/core/task/` (replaced by `@clinebot/agents`)
2. Delete `src/core/controller/` (replaced by SDK adapter)
3. Delete `src/core/api/` (replaced by `@clinebot/llms`)
4. Delete `src/core/prompts/system-prompt/` (replaced by SDK)
5. Delete `src/services/mcp/McpHub.ts` (replaced by SDK MCP manager)
6. Delete `src/standalone/` (no longer needed for VSCode)
7. Delete `src/core/storage/` (replaced by SDK +
   `LegacySessionBackend` adapter)
8. Clean up `src/shared/` — keep only types needed by webview and
   the adapter layer
9. Remove proto host-bridge code (`proto/host/`,
   `src/hosts/external/`)

### Phase 4: JetBrains Migration

**Goal**: Replace standalone cline-core with SDK-based sidecar.

1. **Create lightweight sidecar** (`src/sidecar/`):
   - New Node.js entry point, NOT `clite` (avoids CLI-specific
     code)
   - Imports `@clinebot/core`, shares the SDK adapter layer with
     VSCode
   - JSON-RPC over stdio for Kotlin ↔ Node communication
   - WebviewBridge code is IDE-independent (same as VSCode adapter,
     just different transport)

2. **Plugin Kotlin changes**:
   - `CoreProcessManager` launches new sidecar instead of classic
     `cline-core`
   - Replace `ProtoBusClient`/`ProtoBusProxyService` with JSON-RPC
     stdio client
   - `JsPostMessageHandler` adapted for JSON messages instead of
     gRPC envelope
   - `HostBridgeService` replaced with `HostCallbackService`
     (JSON-RPC server, responds to sidecar callbacks)
   - Same adapted webview loaded via JCEF

3. **Host bridge**: Keep minimal services (clipboard,
   open-external, IDE redirect URI, workspace paths, diagnostics).
   Remove terminal and browser host services. Add extensibility
   for future JetBrains-specific tools (PSI, run configs).

### Phase 5: Polish & Enterprise

**Goal**: Feature parity, enterprise features, final cleanup.

1. **Enterprise**:
   - Remote config download/application
   - SSO role-based access
   - Model/tool controls per team
   - OpenTelemetry/observability integration

2. **P1 Features** (if time allows):
   - Checkpoint system using git refs (kanban-style approach)
   - MCP Marketplace (keep if easy, remove if complex)

3. **Cleanup**:
   - Remove all remaining dead code
   - Update `.clinerules/` documentation
   - Update `CONTRIBUTING.md` and dev setup docs
   - Update `package.json` scripts (remove proto build, standalone
     compile, etc.)

---

## Test Strategy

### Test Inventory

The current codebase has tests across several layers:

| Category | Count | Framework | Location |
|---|---|---|---|
| Extension unit tests | ~120 | Mocha + Sinon | `src/**/__tests__/`, `src/test/` |
| Webview unit tests | ~15 | Vitest + React Testing Library | `webview-ui/src/**/*.test.{ts,tsx}` |
| CLI unit tests | ~15 | Vitest | `cli/src/**/*.test.ts` |
| VSCode E2E tests | ~4 | Playwright | `src/test/e2e/` |
| CLI E2E tests | ~10 | tui-test + custom | `tests/e2e/cli/` |
| Integration tests | ~5 | @vscode/test-cli | `src/test/` (vscode-test) |
| Evals/smoke tests | varies | Custom | `evals/` |

### Test Infrastructure

**Extension unit tests** use Mocha with a custom `requires.ts` that
mocks `vscode` and `@integrations/checkpoints` modules. Config in
`.mocharc.json`. These tests run without VSCode.

**Webview tests** use Vitest with React Testing Library. Independent
from the extension — they test React components in isolation.

**E2E tests** use Playwright to drive a real VSCode instance with
the extension loaded. They test chat, auth, diff editing, and editor
integration against a mock API server on localhost:7777.

### SDK Storage Isolation for Tests

**Key finding**: The SDK fully supports isolated test environments
via environment variables and API calls:

```typescript
// In test setup:
import { setClineDir, setHomeDir } from "@clinebot/shared/storage";
const tempHome = mkdtempSync(join(tmpdir(), "test-home-"));
process.env.HOME = tempHome;
process.env.CLINE_DIR = join(tempHome, ".cline");
process.env.CLINE_DATA_DIR = join(tempHome, ".cline", "data");
setHomeDir(tempHome);
setClineDir(process.env.CLINE_DIR);
```

The SDK's own E2E tests use exactly this pattern (see
`default-session-manager.e2e.test.ts`). The CLI's E2E tests also
use `createIsolatedEnv()` with temp directories. This means:

- Unit tests can run with isolated home dirs (no side effects)
- E2E tests can run with isolated state (no cross-contamination)
- The `vscode-mock.ts` pattern continues to work for tests that
  don't need real VSCode

### Test Classification: DELETE / UPDATE / KEEP

#### DELETE — Covered by SDK (the code they test is being removed)

These tests cover functionality that moves entirely into the SDK.
The SDK has its own test suite for these features.

**API providers & transforms** (~25 tests):
- `src/core/api/providers/__tests__/*.test.ts` (all 13 provider tests)
- `src/core/api/adapters/__tests__/adapters.test.ts`
- `src/core/api/transform/__tests__/*.test.ts` (4 tests)
- `src/core/api/utils/__tests__/messages_api_support.test.ts`
- `src/core/api/retry.test.ts`
- `src/core/api/providers/gemini-mock.test.ts`
- `src/core/api/transform/vscode-lm-format.test.ts`

**Task execution & tool handlers** (~20 tests):
- `src/core/task/__tests__/*.test.ts` (6 tests: Task.ask,
  processNativeToolCalls, TaskPresentationScheduler,
  ToolExecutor, latency, loop-detection)
- `src/core/task/tools/handlers/__tests__/*.test.ts` (7 tests)
- `src/core/task/tools/subagent/__tests__/*.test.ts` (3 tests)
- `src/core/task/tools/utils/__tests__/*.test.ts` (4 tests)
- `src/core/task/multifile-diff.test.ts`

**System prompt** (~7 tests):
- `src/core/prompts/system-prompt/__tests__/*.test.ts` (all 7)
- `src/core/prompts/__tests__/*.test.ts` (2 tests)

**Assistant message parsing** (~3 tests):
- `src/core/assistant-message/diff*.test.ts` (3 tests)

**Context management** (~2 tests):
- `src/core/context/context-management/__tests__/*.test.ts` (2 tests)

**Hooks** (~10 tests):
- `src/core/hooks/__tests__/*.test.ts` (all 10)

**gRPC/proto infrastructure** (~5 tests):
- `src/core/controller/grpc-handler.test.ts`
- `src/core/controller/grpc-recorder/__tests__/*.test.ts` (3 tests)
- `src/test/grpc-handler.test.ts`

**MCP** (~2 tests):
- `src/services/mcp/__tests__/*.test.ts` (2 tests)

**Telemetry** (~3 tests):
- `src/services/telemetry/TelemetryService.test.ts`
- `src/services/telemetry/__tests__/TelemetryService.metrics.test.ts`
- `src/services/telemetry/providers/opentelemetry/__tests__/*.test.ts`

**Storage** (~1 test):
- `src/core/storage/__tests__/disk.test.ts`

**Terminal** (~2 tests):
- `src/hosts/vscode/terminal/VscodeTerminalProcess.test.ts`
- `src/integrations/terminal/CommandOrchestrator.test.ts`

**Other removed-feature tests** (~6 tests):
- `src/test/cline-api.test.ts` (gRPC-based API)
- `src/test/tool-executor-hooks.test.ts` (old hook executor)
- `src/test/hook-executor.test.ts`
- `src/test/hook-management.test.ts`
- `src/test/hook-management-integration.test.ts`
- `src/test/message-state-handler.test.ts`

**Total to DELETE: ~86 tests**

#### UPDATE — Code remains but will change

These tests cover functionality that stays in the extension but will
be modified to work with the SDK adapter layer.

**Rules & instructions** (~5 tests):
- `src/core/context/instructions/user-instructions/__tests__/*.test.ts`
  (5 tests: RuleContextBuilder, frontmatter, rule-conditionals,
  rule-loading, skills)
- *Change*: Data source changes from Controller state to SDK rules
  discovery. Test mocking changes.

**Slash commands** (~2 tests):
- `src/core/slash-commands/__tests__/index.test.ts`
- `src/test/slash-commands.test.ts`
- *Change*: Command set changes (remove /deep-planning, /reportbug,
  workflows). Update test expectations.

**VSCode host bridge** (~5 tests):
- `src/hosts/vscode/hostbridge/env/getHostVersion.test.ts`
- `src/hosts/vscode/hostbridge/window/getOpenTabs.test.ts`
- `src/hosts/vscode/hostbridge/window/getVisibleTabs.test.ts`
- `src/hosts/vscode/hostbridge/workspace/getDiagnostics.test.ts`
- `src/hosts/vscode/hostbridge/workspace/saveOpenDocumentIfDirty.test.ts`
- *Change*: May need to adapt to new controller interface. Could
  remain if VSCode host bridge is kept for VSCode-specific tools.

**Migration** (~1 test):
- `src/hosts/vscode/__tests__/vscode-to-file-migration.test.ts`
- *Change*: Will need to test new SDK migration path instead.

**Workspace** (~4 tests):
- `src/core/workspace/__tests__/*.test.ts` (4 tests)
- *Change*: Workspace resolution may use SDK's workspace support.

**.clineignore** (~1 test):
- `src/core/ignore/ClineIgnoreController.test.ts`
- *Change*: Minor — SDK may have its own ignore support.

**Mentions** (~2 tests):
- `src/core/mentions/index.test.ts`
- `src/shared/__tests__/context-mentions.test.ts`
- *Change*: @-mention resolution may integrate with SDK.

**Context tracking** (~2 tests):
- `src/core/context/context-tracking/FileContextTracker.test.ts`
- `src/core/context/context-tracking/ModelContextTracker.test.ts`
- *Change*: Context tracking integrates with SDK session management.

**Models** (~2 tests):
- `src/core/controller/models/__tests__/refreshClineRecommendedModels.test.ts`
- `src/utils/__tests__/model-utils.test.ts`
- *Change*: Model catalog comes from SDK.

**Remote config** (~2 tests):
- `src/core/storage/__tests__/syncRemoteMcpServers.test.ts`
- `src/shared/remote-config/__tests__/schema.test.ts`
- *Change*: MCP config syncs through SDK MCP manager.

**Webview tests** (~15 tests):
- All `webview-ui/src/**/*.test.{ts,tsx}`
- *Change*: Data sources change from gRPC subscriptions to typed
  JSON messages. Component tests need new mock message providers.
  Settings tests need new `updateSetting` message format.

**Total to UPDATE: ~49 tests**

#### KEEP — No or minimal changes needed

These tests cover pure utility functions, standalone integrations,
or features that are unaffected by the SDK migration.

**Pure utilities** (~10 tests):
- `src/utils/cost.test.ts`
- `src/utils/fs.test.ts`
- `src/utils/path.test.ts`
- `src/utils/retry.test.ts`
- `src/utils/string.test.ts`
- `src/utils/worktree-include.test.ts`
- `src/utils/__tests__/envExpansion.test.ts`
- `src/shared/array.test.ts`
- `src/shared/string.test.ts`
- `src/shared/combineHookSequences.test.ts`

**Standalone integrations** (~7 tests):
- `src/integrations/editor/__tests__/DiffViewProvider.test.ts`
- `src/integrations/diagnostics/__tests__/index.test.ts`
- `src/integrations/notifications/__tests__/notifications.test.ts`
- `src/integrations/claude-code/run.test.ts`
- `src/integrations/checkpoints/__tests__/factory.test.ts`
  (if checkpoint factory is kept for kanban-style)
- `src/services/glob/__tests__/list-files.test.ts`
- `src/services/tree-sitter/__tests__/index.test.ts`

**Services** (~5 tests):
- `src/services/__tests__/selfHosted.test.ts`
- `src/services/banner/__tests__/BannerService.test.ts`
- `src/services/logging/distinctId.test.ts`
- `src/services/uri/SharedUriHandler.test.ts`
- `src/test/services/auth-callback-url.test.ts`

**Other** (~6 tests):
- `src/__tests__/config.test.ts`
- `src/shared/storage/__tests__/provider-keys.test.ts`
- `src/shared/storage/__tests__/state-keys.test.ts`
- `src/shared/__tests__/getApiMetrics.test.ts`
- `src/test/shell.test.ts`
- `src/test/powershell-resolver.test.ts`

**Permissions** (~1 test):
- `src/core/permissions/CommandPermissionController.test.ts`

**Commit message** (~1 test):
- `src/hosts/vscode/__tests__/commit-message-generator.test.ts`

**Account service** (~1 test):
- `src/test/services/ClineAccountService.test.ts`

**Controller file ops** (~2 tests):
- `src/core/controller/file/__tests__/ifFileExistsRelativePath.test.ts`
- `src/core/controller/file/__tests__/openFileRelativePath.test.ts`

**Total to KEEP: ~40 tests**

#### E2E Tests — Special Handling

**VSCode E2E** (`src/test/e2e/`):
- `auth.test.ts` — UPDATE: Auth flow changes (SDK provider
  migration). Mock server responses may change.
- `chat.test.ts` — UPDATE: Message protocol changes. Core chat
  flow should still work. Selectors may change if UI components
  change.
- `diff.test.ts` — UPDATE: Diff editing flow may change if
  DiffViewProvider integration changes.
- `editor.test.ts` — UPDATE: Code actions and editor panel
  integration should largely work. May need peripheral changes.

The E2E tests need the adapted webview and SDK adapter to be
working first (Phase 2 complete). They should be updated
incrementally as each phase is completed.

### Test Strategy by Phase

#### Phase 0 (Cleanup)
- Delete tests for removed features immediately:
  - Browser automation tests (none currently separate)
  - Focus chain test expectations in prompt tests
  - Checkpoint-related assertions
- Run remaining tests to establish baseline: `npm run test:unit`

#### Phase 1 (SDK Backend)
- Write NEW tests for the SDK adapter layer:
  - `LegacySessionBackend` — round-trip HistoryItem ↔ SessionRow
  - `ProviderMigration` — sentinel, idempotency, failure recovery
  - `TelemetryAdapter` — event mapping coverage
  - `ApprovalAdapter` — settings → tool policies
  - `WebviewBridge` — SDK events → webview messages
- Use isolated home directories for all adapter tests
- DELETE tests in the "DELETE" list as their backing code is removed

#### Phase 2 (Webview)
- UPDATE webview tests to use new message format
- UPDATE `ExtensionStateContext` tests (simplified state management)
- DELETE proto/gRPC infrastructure tests
- Write NEW tests for message protocol (serialization, debouncing)

#### Phase 3 (Delete Classic Core)
- Verify all "DELETE" tests are removed
- Run full test suite to confirm no regressions
- UPDATE any remaining tests with stale imports

#### Phase 4 (JetBrains)
- Write NEW tests for sidecar JSON-RPC protocol
- Write NEW tests for HostCallbackClient
- JetBrains integration tests remain in the plugin repo

#### Phase 5 (Polish)
- Full E2E test suite green
- Update smoke tests / evals for SDK
- Performance regression tests (message throughput, startup time)

### Test Framework Decisions

- **Keep Mocha** for extension unit tests (existing infrastructure
  works, `vscode-mock.ts` pattern continues)
- **Keep Vitest** for webview and CLI tests
- **Keep Playwright** for VSCode E2E tests
- **Consider adding Vitest** for new SDK adapter tests (simpler
  setup, better TypeScript support, no need for vscode-mock since
  adapter layer is VSCode-independent)
- **Isolated home directories** for all new tests touching storage

---

### Risk Assessment

| Risk | Mitigation |
|------|------------|
| Webview big-bang breaks everything | Work on a branch; classic extension continues on main |
| SDK tool behavior differs from classic | Comprehensive E2E tests before/after; side-by-side comparison |
| Provider settings migration loses credentials | SDK already has migration code + tests; we add sentinel file |
| Legacy sessions not resumable | Custom `SessionPersistenceAdapter` preserves existing format |
| JetBrains sidecar complexity | Defer to Phase 5; get VSCode solid first |
| SDK missing a feature we need | Submit PRs to SDK repo; `npm link` for quick iteration |
| Telemetry event gaps | Mapping exercise complete; adapter uses SDK's generic `capture()` |
| JSON-RPC message size for large conversations | JSON over stdio has no inherent size limit; streaming deltas keep individual messages small |
| Test coverage gap during migration | Phase-by-phase test strategy; new adapter tests before deleting old ones |

---

## Manual QA Guide

This section is for the QA team. It describes what has been removed
(so you don't file bugs for missing features) and what areas carry
the most regression risk after the SDK migration.

### Removed Features — Do Not File Bugs

The following features have been intentionally removed from VSCode &
JetBrains:

- **Browser automation** — The built-in Playwright browser tool
  (launch, click, type, screenshot) is gone. Users should use
  third-party MCP browser tools instead. Any UI related to browser
  sessions (screenshot previews, browser action rows in chat) will
  no longer appear.

- **IDE terminal integration** — The old mode where Cline ran
  commands inside your IDE's visible terminal panels is removed.
  Commands now run exclusively in a "background terminal" (a
  headless shell process). You should still see command output
  streamed in the chat, but there will be no corresponding terminal
  tab opening in the IDE.

- **Shadow-git checkpoints** — The system that copied the entire
  repository into a shadow `.git` directory for file snapshots is
  removed. Existing checkpoints created by the old system are
  invalidated and will not appear in the UI. (A new, faster
  checkpoint system using git refs is planned as a follow-up.)

- **Memory bank / structured context** — The multi-file
  documentation system (`projectbrief`, `productContext`,
  `activeContext`, `systemPatterns`, `techContext`, `progress`) and
  cross-session persistence is removed. Any UI for viewing or
  editing memory bank files will be gone.

- **Focus chain** — The auto-generated to-do list with real-time
  progress indicators, and the editable focus chain integration
  with deep planning, is removed. No focus chain panel or inline
  indicators should appear.

- **Deep planning / `/deep-planning`** — The codebase investigation
  and plan generation command is removed. Plan/Act mode remains and
  is the replacement.

- **`/reportbug`** — The bug-reporting slash command with
  diagnostics is removed.

- **Workflows** — The workflow definition system (natural language +
  XML tool syntax, user input prompts) is removed.  Skills (SKILL.md
  format) are the replacement.

- **Custom workflow slash commands** — User-defined `/workflow.md`
  commands are removed. Skills replace this capability.

### Risk Areas — VSCode Extension

These areas have significant implementation changes and deserve
focused testing:

1. **Provider credentials & model selection** — All 30+ provider
   configurations are being migrated from the old storage format
   (`globalState.json` + `secrets.json`) to a new SDK-managed
   `providers.json`. **Verify that existing API keys, model
   selections, and custom endpoints survive the upgrade.** Test
   every provider you can, especially: Anthropic, OpenRouter,
   Bedrock, Ollama, LM Studio, and the Cline provider with SSO.
   Also verify downgrade: if a user rolls back to the old extension
   version, they should not lose their credentials.

2. **Cline provider OAuth / SSO** — The authentication flow (open
   browser → SSO redirect → token stored) is being ported to a new
   SDK adapter. Test sign-in, sign-out, token refresh, org
   switching, credit display, and billing banners.

3. **Chat streaming & message display** — The entire communication
   layer between the extension backend and the webview is being
   replaced (gRPC-over-postMessage → typed JSON messages). Watch
   for: missing or duplicated messages, broken streaming (text
   arriving out of order or freezing), incorrect partial rendering,
   and performance regressions (high CPU/memory during long
   streaming responses).

4. **Tool approval flow** — Auto-approve settings and YOLO mode are
   being mapped to a new SDK policy system. Verify that: approval
   popups appear when expected, auto-approved tools execute without
   prompting, per-tool permission toggles work, and YOLO mode
   correctly bypasses all approvals.

5. **Plan/Act mode** — Mode switching, separate model configs per
   mode, and state persistence across mode switches are being
   re-wired through the SDK. Verify toggling between modes, that
   the correct model is used in each mode, and that switching modes
   mid-task preserves history.

6. **Task history & resume** — The session backend is a custom
   adapter over the existing JSON files. Verify that: old tasks
   appear in history, old tasks can be resumed, new tasks are saved
   and resumable, and cost/token tracking is accurate.

7. **MCP servers** — `McpHub` is replaced by the SDK's MCP manager.
   Verify: existing MCP server configs are picked up, servers
   connect and tools are discovered, tool calls work, and
   enable/disable/restart work.

8. **VSCode LM provider (Copilot)** — This provider uses a
   VSCode-specific API and is being re-registered through the SDK's
   custom handler system. Verify it still works for users with
   Copilot access.

9. **Settings UI** — The settings panels are being re-wired from
   gRPC subscriptions to typed messages. Verify all toggles and
   inputs persist correctly (auto-approve settings, model config,
   MCP config, rules toggles, skills toggles, hook config).

10. **Webview performance** — The old system had known issues with
    n² state updates during streaming. The new system batches and
    debounces. Verify that long conversations don't cause the
    webview to become sluggish or unresponsive.

### Risk Areas — JetBrains Extension

JetBrains is migrating last (Phase 5) and has the most architectural
change. Everything in the VSCode list above applies, plus:

1. **Sidecar process lifecycle** — The Node.js sidecar is changing
   from gRPC ProtoBus to JSON-RPC over stdio. Verify: the sidecar
   starts reliably, recovers from crashes (auto-restart), and shuts
   down cleanly when the IDE closes.

2. **Webview communication** — The bridge between the Kotlin plugin
   and the JCEF webview is being rewritten from gRPC envelopes to
   JSON messages. Watch for: messages not arriving in the webview,
   the webview showing stale state, or the chat appearing blank
   after a sidecar restart.

3. **Large conversations** — The old gRPC system hit 256MB message
   size limits and caused Java heap pressure with large
   conversations. The new JSON-RPC streaming approach should fix
   this, but verify that very long conversations (100K+ tokens)
   work without errors or OOM crashes.

4. **Host operations** — IDE-specific operations (open file, show
   diagnostics, workspace paths, clipboard) are being re-implemented
   via a new JSON-RPC callback mechanism. Verify that: clicking file
   links in chat opens the correct file, diagnostics are reported
   accurately, and copy-to-clipboard works.

5. **Keybindings** — The old webview had a known defect showing
   wrong keybindings for JetBrains. Verify that keyboard shortcuts
   displayed in the UI are correct for the JetBrains platform.

### Risk Areas — CLI

1. **Agent backend replacement** — `ClineAgent` / `ClineSessionEmitter`
   are being replaced with SDK session management. Verify the core
   loop: start a task, see streaming output, tool calls execute,
   task completes. Test both TUI mode (`cline --tui`) and headless
   mode.

2. **Provider & model picker** — The CLI's provider/model selection
   UI is being rewired to use the SDK's model catalog. Verify that
   all providers appear, default models are correct, and switching
   providers works.

3. **Shared state with IDE clients** — The CLI shares
   `~/.cline/data/` with VSCode and JetBrains. After the migration,
   verify that: credentials set in VSCode are usable from the CLI,
   task history from the CLI is visible in VSCode, and vice versa.
   Also verify that running the CLI and an IDE simultaneously does
   not corrupt shared state files.

4. **Slash commands** — The command set is changing (removed commands
   listed above). Verify that `/newtask`, `/smol`, and `/newrule`
   work. Verify removed commands do not appear in autocomplete.

5. **Worktrees & `--cwd`** — Verify that `cline --cwd /path` works
   correctly and that git worktree support (branch management,
   `.worktreeinclude`) functions as expected.

6. **ACP (Agent Communication Protocol)** — The ACP agent is being
   adapted to use SDK sessions. Verify that programmatic/headless
   agent usage still works for automation scenarios.

---

## Revised Implementation Approach

This section replaces the high-level phases above with a concrete,
test-first, incremental approach informed by the retrospective.

### Principle 1: Keep the Existing Webview, Speak Its Language

**DO NOT** create new stub webview components (SdkApp.tsx, SdkChatRow,
SdkSettingsView, etc.). Instead:

1. Keep `webview-ui/src/App.tsx` and all existing React components
   exactly as they are.
2. Keep `webview-ui/src/context/ExtensionStateContext.tsx` as the
   state provider.
3. The SDK backend must produce messages that the existing webview
   understands — specifically, it must speak the gRPC-over-postMessage
   protocol (or a thin wrapper that satisfies the webview's
   `grpc_response` message handler).

**Why this works**: The webview is the largest, most complex, most
visually-tested part of the system. Rewriting it introduces hundreds
of subtle bugs. Instead, we make the backend conform to the existing
interface contract, then simplify the webview incrementally once it's
working.

**The gRPC compatibility layer (`grpc-handler.ts`) from the failed
branch was actually the right idea** — it just needed to be the
*only* approach, not a parallel one. And it needed tests.

**Migration path for the webview**:
1. **Phase A**: gRPC compat layer speaks the full existing protocol.
   Classic webview works unchanged. User can test everything.
2. **Phase B**: Once working, incrementally replace gRPC subscriptions
   in `ExtensionStateContext.tsx` with simpler typed-message listeners.
   Each replacement is a small, testable diff.
3. **Phase C**: Once all gRPC is gone from the webview, delete the
   compat layer and proto dependencies.

### Principle 2: Define the Extension ↔ Webview Interface Contract

The interface between the extension and webview is currently defined
implicitly by:

1. **gRPC service definitions** in `proto/cline/*.proto`
2. **`ExtensionState`** type in `src/shared/ExtensionMessage.ts`
3. **`ClineMessage`** type in `src/shared/ExtensionMessage.ts`
4. **Various proto message types** scattered across `src/shared/proto/`

**Step 1: Extract the interface contract as TypeScript types**

Create `src/sdk/interface-contract.ts` that explicitly defines:

```typescript
/**
 * The complete state object the webview expects.
 * This is the ACTUAL ExtensionState shape — not an approximation.
 * Every field here is used by at least one webview component.
 */
export type WebviewState = ExtensionState  // Re-export from shared

/**
 * Messages the webview sends to the extension.
 * Extracted from the gRPC service definitions.
 */
export type WebviewRequest =
  | { service: "StateService"; method: "getLatestState"; ... }
  | { service: "StateService"; method: "subscribeToState"; ... }
  | { service: "TaskService"; method: "newTask"; text: string; ... }
  | { service: "TaskService"; method: "askResponse"; ... }
  | { service: "ModelsService"; method: "updateApiConfiguration"; ... }
  // ... every method the webview actually calls

/**
 * Messages the extension sends to the webview.
 * Extracted from the gRPC streaming subscriptions.
 */
export type WebviewPush =
  | { subscription: "state"; state: WebviewState }
  | { subscription: "partialMessage"; message: ClineMessage }
  | { subscription: "mcpServers"; servers: McpServer[] }
  // ... every streaming response the webview listens for
```

**Step 2: Snapshot-test the interface**

Create snapshot tests that capture the *shape* of state objects that
the classic extension produces. Run these against the classic
extension first (on `main`), then verify the SDK adapter produces
compatible shapes:

```typescript
// src/sdk/__tests__/interface-contract.test.ts
describe("state-builder produces valid ExtensionState", () => {
  it("matches snapshot for fresh install", () => {
    const state = buildExtensionState(mockController, [], [])
    // Verify all required fields exist and have correct types
    expect(state.apiConfiguration).toBeDefined()
    expect(state.apiConfiguration.apiProvider).toBeTypeOf("string")
    expect(state.clineMessages).toBeInstanceOf(Array)
    expect(state.mode).toMatch(/^(act|plan)$/)
    // ... every field the webview reads
  })

  it("matches snapshot for active session", () => {
    const messages = [testClineMessage("task"), testClineMessage("text")]
    const state = buildExtensionState(mockController, messages, [])
    expect(state.currentTaskItem).toBeDefined()
    expect(state.currentTaskItem!.id).toBeTruthy()
  })
})
```

**Step 3: Catalog which gRPC methods the webview actually calls**

Grep the webview source for every gRPC client call. This produces the
authoritative list of methods the gRPC handler must implement (not
just stub). The handler should log warnings for unimplemented methods
rather than silently returning `{}`.

### Principle 3: Agent Observability Design

The agent (Cline working on this migration) needs fast feedback loops
that don't require a human to manually test the extension. Here's the
observability stack:

#### 3a. Unit tests as the primary feedback loop

Every SDK adapter module gets comprehensive unit tests using Vitest
(not Mocha — the SDK adapter code is VSCode-independent):

```
src/sdk/__tests__/
  message-translator.test.ts     — SDK events → ClineMessage[]
  state-builder.test.ts          — Controller state → ExtensionState
  legacy-state-reader.test.ts    — Read ~/.cline/data/ files
  provider-migration.test.ts     — Credential migration
  grpc-handler.test.ts           — gRPC request routing
  event-bridge.test.ts           — SDK events → webview pushes
  interface-contract.test.ts     — State shape validation
```

These tests run instantly (`npx vitest run src/sdk/`) and give the
agent immediate feedback on whether the adapter layer is correct.

**Test isolation**: Each test creates a temp directory with synthetic
`globalState.json`, `secrets.json`, `taskHistory.json` etc. No real
user data is touched.

**Test fixtures**: Create
`src/sdk/__tests__/fixtures/sample-global-state.json` etc. with
realistic data from a real Cline installation (scrubbed of real keys).

#### 3b. Extension Host debugging (for the agent)

Create a launch configuration and helper script that lets the agent:

1. Build the extension with source maps
2. Launch a VSCode Extension Development Host
3. Capture the Output Channel logs programmatically
4. Evaluate expressions via the debug console

**`scripts/debug-sdk-extension.sh`**:
```bash
#!/bin/bash
# Build unminified with source maps
NODE_ENV=development node esbuild.mjs --sourcemap
# Build webview
cd webview-ui && npm run build && cd ..
# Launch extension host (headless or with window)
code --extensionDevelopmentPath="$(pwd)" \
     --disable-extensions \
     "$@"
```

**`.vscode/launch.json` entry for SDK extension**:
```json
{
  "name": "Debug SDK Extension",
  "type": "extensionHost",
  "request": "launch",
  "args": ["--disable-extensions", "--extensionDevelopmentPath=${workspaceFolder}"],
  "outFiles": ["${workspaceFolder}/dist/**/*.js"],
  "sourceMaps": true,
  "env": {
    "CLINE_SDK_DEBUG": "1",
    "NODE_ENV": "development"
  }
}
```

**Key**: The `esbuild.mjs` must support a `--sourcemap` flag that
produces unminified output with source maps. This lets the agent
(or a human) set breakpoints in the TypeScript source.

#### 3c. Structured logging in the SDK adapter

The `SdkController` already has an `outputChannel`. Enhance this with
structured JSON logging that the agent can parse:

```typescript
// src/sdk/logger.ts
export function sdkLog(channel: vscode.OutputChannel, event: {
  level: "debug" | "info" | "warn" | "error"
  component: string
  action: string
  data?: Record<string, unknown>
}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...event,
  })
  channel.appendLine(line)
}
```

Usage:
```typescript
sdkLog(this.outputChannel, {
  level: "info",
  component: "grpc-handler",
  action: "request",
  data: { service, method, requestId },
})
```

The agent can then `grep` the Output Channel log for specific
components/actions instead of reading unstructured text.

#### 3d. E2E smoke test against mock API

Adapt the existing E2E test infrastructure (`src/test/e2e/`) to work
with the SDK extension. The mock API server on localhost:7777 already
exists. The key additions:

1. **Configure the SDK extension to use the mock API**: Set the
   provider to "cline" with `baseUrl: "http://localhost:7777"` in
   an isolated `providers.json`.

2. **Playwright test that verifies core flow**:
   ```typescript
   test("SDK extension: send message and see response", async ({ page }) => {
     // Wait for sidebar to load
     await page.waitForSelector('[data-testid="chat-input"]')
     // Type a message
     await page.fill('[data-testid="chat-input"]', "Hello")
     await page.click('[data-testid="send-button"]')
     // Verify response appears
     await page.waitForSelector('.chat-row >> text=Hello')
     await page.waitForSelector('.chat-row >> text=mock response')
   })
   ```

3. This test is the **canary**: if it passes, the entire pipeline
   (SDK adapter → gRPC handler → state builder → webview) is
   working end-to-end. If it fails, the agent knows immediately.

### Principle 4: Units-at-a-Time Methodology

Don't try to wire everything at once. Build and test one unit at a
time. Each unit is a PR-sized chunk with its own tests.

#### Unit 1: Foundation (clean branch, build green, tests pass)

**Starting point**: Fresh branch from `main` (not from the broken
`sdk-migration-port-check`).

Tasks:
- Add SDK npm dependencies (`@clinebot/core`, `@clinebot/agents`,
  `@clinebot/llms`, `@clinebot/shared`)
- Verify the classic extension still builds and all existing tests
  pass with the new dependencies
- Create `src/sdk/` directory structure
- Create `src/sdk/__tests__/` with test infrastructure (Vitest
  config, fixtures)
- Add `vitest.config.sdk.ts` for running SDK adapter tests
- Add npm script: `"test:sdk": "vitest run --config vitest.config.sdk.ts"`
- **Deliverable**: Green build, all existing tests pass, empty
  `src/sdk/` ready for code.

#### Unit 2: Legacy state reader + tests

Tasks:
- Implement `src/sdk/legacy-state-reader.ts` (already mostly done)
- Create fixture files in `src/sdk/__tests__/fixtures/`:
  - `globalState.json` with realistic provider config
  - `secrets.json` with fake API keys
  - `taskHistory.json` with sample tasks
- Write tests:
  - Reads provider from globalState correctly
  - Reads API key from secrets correctly
  - Handles missing files gracefully
  - Handles corrupt JSON gracefully
  - Reads auto-approval settings
  - Reads custom instructions
  - Reads task history
- **Deliverable**: `legacy-state-reader.ts` with 10+ tests passing.

#### Unit 3: Provider migration + tests

Tasks:
- Implement `src/sdk/provider-migration.ts`
- Write tests:
  - Migrates Anthropic key from secrets.json → providers.json
  - Migrates OpenRouter key
  - Migrates Bedrock credentials
  - Sentinel prevents re-migration
  - Existing providers.json entries are not overwritten
  - Handles missing secrets.json
  - Handles corrupt files
- **Deliverable**: `provider-migration.ts` with 8+ tests passing.

#### Unit 4: Message translator + tests

Tasks:
- Implement `src/sdk/message-translator.ts` (already mostly done)
- Write comprehensive tests:
  - `iteration_start` → `api_req_started` ClineMessage
  - `content_start` (text) → streaming text ClineMessage
  - `content_start` (reasoning) → streaming reasoning ClineMessage
  - `content_start` (tool: read_files) → tool ClineMessage
  - `content_start` (tool: run_commands) → command ClineMessage
  - `content_start` (tool: ask_question) → ask ClineMessage
  - `content_end` (text) → finalized text ClineMessage
  - `content_end` (tool with output) → command_output ClineMessage
  - `content_end` (tool with error) → error ClineMessage
  - `usage` → api_req_finished ClineMessage
  - `done` → completion_result ClineMessage
  - `error` → error ClineMessage
  - Multiple iterations accumulate correctly
  - Reset clears state
- **Deliverable**: `message-translator.ts` with 15+ tests passing.

#### Unit 5: State builder + interface contract tests

Tasks:
- Implement `src/sdk/state-builder.ts` (already mostly done)
- Implement `src/sdk/interface-contract.ts`
- Extract the list of fields `ExtensionStateContext.tsx` actually
  reads from the state object (grep for `state.` patterns)
- Write tests:
  - Every field the webview reads is present and correctly typed
  - Fresh install state snapshot
  - Active session state snapshot
  - Settings round-trip (legacy state → ExtensionState → webview
    can read provider, model, mode, etc.)
  - State with task history
  - State with clineMessages
- **Deliverable**: `state-builder.ts` with 10+ tests, snapshot
  tests for state shape.

#### Unit 6: gRPC handler + tests

Tasks:
- Implement `src/sdk/grpc-handler.ts` (already mostly done)
- Catalog every gRPC method the webview calls (grep webview source)
- Write tests for critical paths:
  - `getLatestState` returns valid state JSON
  - `subscribeToState` stores subscription ID
  - `newTask` creates session and pushes state
  - `askResponse` with messageResponse sends prompt
  - `clearTask` resets state and pushes cleared sentinel
  - `getTaskHistory` returns history
  - `updateApiConfiguration` updates provider/model
  - `togglePlanActModeProto` switches mode
  - Unknown methods return empty response (not error)
- **Deliverable**: `grpc-handler.ts` with 12+ tests passing.

#### Unit 7: SdkController + integration test

Tasks:
- Implement `src/sdk/SdkController.ts` (already mostly done)
- Implement `src/sdk/event-bridge.ts`
- Write integration test with mocked SessionHost:
  - Create controller with mock webview
  - Send "ready" message, verify state push
  - Send "newTask", verify session start
  - Simulate SDK events, verify ClineMessage updates
  - Send "abort", verify abort call
  - Send "reset", verify cleanup
- **Deliverable**: Full adapter layer with integration test.

#### Unit 8: Extension entry point + E2E smoke test

Tasks:
- Implement `src/sdk/extension-sdk.ts` as alternate entry point
- Wire it into `esbuild.mjs` behind a flag (e.g.,
  `CLINE_SDK=1 node esbuild.mjs` produces `dist/sdk-extension.js`)
- Update `package.json` to support dual entry points (classic stays
  default; SDK activated by setting)
- Write E2E smoke test:
  - Launch extension development host with SDK entry point
  - Verify sidebar loads
  - Verify provider list populates
  - Verify sending a message to mock API produces chat response
- **Deliverable**: Working extension that can be tested by human
  or Playwright.

#### Unit 9: Webview simplification (incremental)

Once Unit 8 is working end-to-end via the gRPC compat layer:

- **9a**: Replace `subscribeToState` gRPC subscription with direct
  `window.addEventListener("message")` for state pushes. Keep the
  gRPC handler pushing state the same way but also send a direct
  typed message. Webview picks up whichever arrives.

- **9b**: Replace `subscribeToPartialMessage` with typed message.

- **9c**: Replace model/provider refresh RPCs with typed messages.

- **9d**: Replace remaining gRPC subscriptions one by one.

Each sub-step is a small diff with tests. The webview works at every
intermediate step.

#### Unit 10: Delete classic core

Once all webview communication goes through typed messages (no more
gRPC):

- Delete `proto/cline/*.proto`
- Delete `src/shared/proto-conversions/`
- Delete `src/generated/`
- Delete `src/core/task/`, `src/core/controller/`, `src/core/api/`,
  etc.
- Delete `src/standalone/`
- Fix all remaining import errors
- Run full test suite
- **Deliverable**: Clean codebase with only SDK adapter + webview.

### Implementation Checklist

```
Phase A — Foundation & Adapter Layer (Units 1-7)
  [ ] Unit 1: Clean branch, SDK deps, test infra
  [ ] Unit 2: Legacy state reader + tests
  [ ] Unit 3: Provider migration + tests
  [ ] Unit 4: Message translator + tests
  [ ] Unit 5: State builder + interface contract tests
  [ ] Unit 6: gRPC handler + tests
  [ ] Unit 7: SdkController integration test

Phase B — Working Extension (Unit 8)
  [ ] Unit 8: Extension entry point + E2E smoke test
  [ ] Human verification: model picker works, chat works, settings work

Phase C — Webview Simplification (Unit 9)
  [ ] Unit 9a: Replace state subscription
  [ ] Unit 9b: Replace partial message subscription
  [ ] Unit 9c: Replace model/provider RPCs
  [ ] Unit 9d: Replace remaining gRPC calls

Phase D — Cleanup (Unit 10)
  [ ] Unit 10: Delete classic core, proto, gRPC
  [ ] Full test suite green
  [ ] E2E tests updated and passing

Phase E — JetBrains (Phase 4 from original plan)
  [ ] JetBrains sidecar

Phase F — Polish & Enterprise (Phase 5 from original plan)
  [ ] Enterprise features
  [ ] P1 features
  [ ] Final cleanup
```
