# SDK Migration — Architecture & Design

Evergreen reference for the Cline SDK migration project. For the
living implementation plan, see `migration.md`.

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

---

## Features

### Features to remove

Terminal integration: There is existing VSCode-specific terminal code in the VSCode extension,
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

Task organization - favorites for task grouping and management

File context - Drag and drop files to add to context
File context - actions - context menus to add to Cline, fix, explain, improve

Slash commands
/explain-changes (git diff explanation)

---

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
`existing-disk-format session backend` adapter wraps the existing
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

The shared SDK adapter layer contains:

```
src/sdk-adapter/
  index.ts              — ClineSdkHost (creates ClineCore instance)
  session-backend.ts    — existing-disk-format session backend adapter
  webview-bridge.ts     — SDK events → webview message translation
  provider-migration.ts — old provider settings migration
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

## Architecture Overview

### Current Architecture
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

### Target Architecture
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

---

## What the SDK Already Provides

These capabilities exist in the SDK and do not need to be rebuilt:

1. **Old provider settings migration** —
   The SDK's built-in provider-settings migration reads `globalState.json` +
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
   migration of config files written by earlier Cline versions.

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
   See "Telemetry Event Mapping" above for full mapping.

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

---

## Test Strategy

See `migration.md` for the phase-by-phase test plan. This section
covers the evergreen test infrastructure and classification.

### Test Infrastructure

**Extension unit tests** use Mocha with a custom `requires.ts` that
mocks `vscode` and `@integrations/checkpoints` modules. Config in
`.mocharc.json`. These tests run without VSCode.

**Webview tests** use Vitest with React Testing Library. Independent
from the extension — they test React components in isolation.

**E2E tests** use Playwright to drive a real VSCode instance with
the extension loaded. They test chat, auth, diff editing, and editor
integration against a mock API server on localhost:7777.

**SDK adapter tests** use Vitest (simpler setup, better TypeScript
support, no need for vscode-mock since adapter layer is
VSCode-independent). Config in `vitest.config.sdk.ts`.

### SDK Storage Isolation for Tests

The SDK fully supports isolated test environments via environment
variables and API calls:

```typescript
import { setClineDir, setHomeDir } from "@clinebot/shared/storage";
const tempHome = mkdtempSync(join(tmpdir(), "test-home-"));
process.env.HOME = tempHome;
process.env.CLINE_DIR = join(tempHome, ".cline");
process.env.CLINE_DATA_DIR = join(tempHome, ".cline", "data");
setHomeDir(tempHome);
setClineDir(process.env.CLINE_DIR);
```

### Test Framework Decisions

- **Keep Mocha** for extension unit tests (existing infrastructure)
- **Keep Vitest** for webview and CLI tests
- **Keep Playwright** for VSCode E2E tests
- **Add Vitest** for new SDK adapter tests
- **Isolated home directories** for all new tests touching storage

---

## Manual QA Guide

This section is for the QA team. It describes what has been removed
(so you don't file bugs for missing features) and what areas carry
the most regression risk after the SDK migration.

### Removed Features — Do Not File Bugs

- **Browser automation** — The built-in Playwright browser tool is
  gone. Users should use third-party MCP browser tools instead.
- **IDE terminal integration** — Commands now run exclusively in a
  "background terminal" (headless shell). No terminal tab opens.
- **Shadow-git checkpoints** — Existing checkpoints are invalidated.
- **Memory bank / structured context** — All memory bank files and
  UI removed.
- **Focus chain** — No focus chain panel or inline indicators.
- **Deep planning / `/deep-planning`** — Plan/Act mode remains as
  the replacement.
- **`/reportbug`** — Removed.
- **Workflows** — Skills (SKILL.md format) are the replacement.
- **Custom workflow slash commands** — Skills replace this.

### Risk Areas — VSCode Extension

1. **Provider credentials & model selection** — Verify existing API
   keys survive the upgrade and downgrade.
2. **Cline provider OAuth / SSO** — Test sign-in, sign-out, token
   refresh, org switching.
3. **Chat streaming & message display** — Watch for missing/duplicated
   messages, broken streaming, performance regressions.
4. **Tool approval flow** — Verify auto-approve, YOLO mode, per-tool
   permissions.
5. **Plan/Act mode** — Verify toggling, separate model configs,
   state persistence.
6. **Task history & resume** — Old tasks appear, can be resumed; new
   tasks are saved.
7. **MCP servers** — Existing configs picked up, tools work.
8. **VSCode LM provider (Copilot)** — Verify it still works.
9. **Settings UI** — All toggles and inputs persist correctly.
10. **Webview performance** — Long conversations should not cause
    sluggishness.

### Risk Areas — JetBrains Extension

1. **Sidecar process lifecycle** — Starts reliably, auto-restarts,
   shuts down cleanly.
2. **Webview communication** — Messages arrive, state is fresh.
3. **Large conversations** — 100K+ tokens without OOM.
4. **Host operations** — Open file, diagnostics, clipboard all work.
5. **Keybindings** — Correct for the JetBrains platform.

### Risk Areas — CLI

1. **Agent backend replacement** — Core loop works in TUI and
   headless modes.
2. **Provider & model picker** — All providers appear, defaults
   correct.
3. **Shared state with IDE clients** — Credentials and history
   visible across clients.
4. **Slash commands** — Removed commands don't appear; remaining
   ones work.
5. **Worktrees & `--cwd`** — Function correctly.
6. **ACP (Agent Communication Protocol)** — Programmatic usage works.
