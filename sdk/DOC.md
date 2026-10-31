## Plugin slash commands

Use `core.pluginCommands` on an existing `ClineCore` (local or hub-backed), or
`client.pluginCommands` on an existing `HubSessionClient`. Hosts with a
`NodeHubClient` can use `createHubPluginCommandsApi(client)` from `@cline/core`.
These APIs reuse the runtime and connection; clients do not load plugins or own
a separate command sandbox. Pass the active `sessionId` so a command runs in
that session's plugin instance and retains the state and context shared with
its hooks.

If a connection closes after a command is dispatched, execution rejects without
automatically resending it: the command may already have changed external state.

```ts
const target = { workspacePath: workspaceRoot, sessionId };
const catalog = await core.pluginCommands.list(target);
const result = await core.pluginCommands.run({ ...target, prompt: "/upload-history" });
// Display result?.reply; submit only result?.submitPrompt to the agent.
// undefined means no registered command handled the input.
```

Omit `sessionId`, or pass one the runtime does not have, to use the workspace
catalog. Every call checks the enabled plugins and their sources and reloads the
catalog when they change, so call `list` again whenever the command menu needs to be
current. A failed load lists healthy commands with `status: "error"` and is
retried after 30 seconds. Workspace catalogs idle for 10 minutes release their
plugin workers.

For a resident session, listing and execution use its initialized contribution
registry and existing plugin sandbox. Workspace file changes apply to new
sessions, not an active session's commands. Built-in command precedence and
rendering remain host responsibilities. Preserve the original arguments when
dispatching.

## Model request retries and Langfuse

AI SDK text requests allow three retries after the initial request (four total
attempts) for retryable request-start failures. Provider errors received after
streaming starts have a separate budget of three stream retries. Exhausting
either budget does not trigger another whole-turn retry.

When Langfuse tracing is enabled, each failed request-start or stream attempt
records its error on its model-call span, including attempts followed by a
successful retry. Request-start failures close their attempt spans before retry
backoff begins. A recovered request keeps a successful overall trace; exhausted
retries mark the overall operation as failed. Span export follows the configured
telemetry processor's flushing policy.

Caller cancellation closes model-call spans without recording an exception or
marking a provider failure, including cancellation before the response opens.
Timeout cancellations remain failures.

## Oversized tool result recovery

Cached text excludes native image data. Cache admission uses the persisted JSON/string model-preview size for the truncation threshold; YAML size controls only cache capacity. Plain strings stay unchanged; structured cached text is serialized as YAML, preserving multiline payloads as literal blocks without automatic wrapping. Original history and tool events keep their existing format. Recovery uses the existing `read_files` output and per-line limits; disabling that tool does not disable caching or remove recovery notices.

Tools created with `createTool` may set `resultPolicy: "cache-oversized"`. Core enables this for MCP and Composio tools. Original output remains in history and events; synchronous model preparation sends a bounded preview with a `cline://cache/<encoded-session-id>/<result-id>.result.txt` URI for cached oversized responses. Use `read_files` with `start_line`/`end_line` to read omitted content. Shell and filesystem search tools do not support these URIs. The stateless agent runtime does not own a cache.

Entries expire after five further model iterations without a cache read, across follow-up turns. Explicit reads refresh expiry; model requests do not. A 16 MiB UTF-8 text limit per session evicts least recently read entries; individually larger results have no recovery URI. Shutdown, history reset, and restore clear the cache, and resume does not regenerate entries. Missing reads instruct the agent to refetch with an appropriate read/query tool without repeating side-effecting actions. Evicting cached text does not remove original conversation output or change earlier recovery notices; URI references remain until the cache is cleared. Cache-miss feedback appears only when an agent attempts to read missing content.

## Shared agent review UI

`@cline/ui` exports presentation-only components for showing a session's changed
files and pull-request status. Configure Tailwind v4 and a token entry point before
importing `@cline/ui/components.css`, following the
[complete styling setup](./packages/ui/ADOPTION.md#option-2-tailwind-mappings-without-base-styles).
Then import the components from the package root:

```tsx
import {
  AgentChangedFile,
  AgentChangesPanel,
  AgentPullRequestBar,
} from "@cline/ui";
```

`AgentChangesPanel` owns the Changes header, count, close action, empty state,
and scroll region. Compose `AgentChangedFile` children to show collapsible paths,
copy feedback, additions/deletions, host-provided actions, and rendered diff
content. The host retains change collection, clipboard and editor integration,
and conversation focus.

`AgentPullRequestBar` accepts normalized `AgentPullRequestData` plus loading and
error state. The host owns refresh, polling, navigation, and telemetry, and
provides its accessible checks popover through `renderChecks`. Native hosts can
intercept links with `onNavigate`; web hosts can omit it to render external
anchors. `getAgentPullRequestMergeStatus` and
`summarizeAgentPullRequestChecks` expose the same status normalization for other
host presentation.

## Fork metadata

`createForkSessionMetadata` from `@cline/core` copies metadata, replaces fork ancestry, and removes inherited handoff markers. Callers supply the source ID, timestamp, source, and optional `beforeRunCount`; titles and session creation remain caller-owned.

## Starting a runtime from saved Hub history

`session.resume` starts a runtime for a saved `sessionConfig.sessionId`. It accepts the execution configuration used by `session.create`, but reads conversation history on the Hub instead of requiring `initialMessages`. It prefers the live conversation when available and otherwise reads persisted history. Startup, replies, and session events use the existing `session.create` path.

A missing ID returns `invalid_resume`, a missing session returns `session_not_found`, and empty history returns `session_messages_not_found`. These errors do not start a runtime. `session.create` remains unchanged, including empty context when `initialMessages` is omitted.

Only `unsupported_command` permits falling back to `session.messages` followed by `session.create` with explicit history.

## Cloud sessions (experimental)

`summarizeConversation({ messages, config, signal? })` from `@cline/core` returns
a continuation note without changing session history or compaction state.
Top-level credentials in `config` override those in `providerConfig`.
The request retains the prior summary, latest instruction, and its most recent
response. It shortens older context to fit the model's input limit and rejects
requests if the retained context cannot fit. It also rejects
empty, incomplete, failed, or cancelled output. Claude Code, Codex CLI, OpenCode,
and Dify are unsupported because they may execute their own tools.

`CloudSessionApi` and `CloudSessionController` are exported from `@cline/core/cloud`.
The API handles REST requests; the controller handles remote Hub connections,
session lifecycle, transcript reconciliation, and approvals. Hosts provide API
URLs and a fresh-token callback; feature gating and account selection stay in the
host. Importing this subpath does not start a local agent.

`createPublishArtifactsTool({ publish })` from `@cline/core` creates the opt-in
`publish_artifacts` tool. It validates batches and local file paths, assigns missing
IDs, and returns ordered per-file IDs or errors. The injected `ArtifactPublisher`
receives prepared files (`path`, `artifactId`, `size`, `modifiedAt`) and an abort
signal, and returns one result per file in input order. Storage-specific policy
and persistence belong to the publisher; constructing the tool does not register
it in default local tools. Hosts control tool approval and which local paths may
be published; the tool itself does not restrict paths to a workspace.

For cloud sessions, inject `createArtifactPublisher({ request, cloudSessionId })`
from `@cline/core/cloud`. The host provides authenticated transport and the owning
session ID. The publisher uploads directly with one signed policy per batch,
refreshes expired policies, and retries transient failures with the same IDs.
The service remains responsible for upload authorization and limits.

`createArtifactFetcher({ request, cloudSessionId })` from `@cline/core/cloud`
returns `fetchArtifact({ artifactId, signal? })`, which downloads a streaming
`Response`. Each fetcher caches up to 128 signed URLs, refreshing 30 seconds before
expiry or once after a storage HTTP 403. Missing files and file bytes are not cached.
Reuse one fetcher per authenticated account/session; discard it on sign-out or
account changes. Cache hits do not recheck session permissions until URL renewal.
Wait for a successful publication result before fetching a new artifact. The caller
consumes or cancels the response body and applies any read size limit. The optional
signal cancels the download, including while reading its body. This helper does not
register an agent tool or attach files to messages.

`HubCloudSessionClient.getArtifactDownloadUrl(sessionId, artifactId)` resolves
an existing artifact through the authenticated Hub without starting its sandbox.
It returns a signed HTTPS URL and expiry for clients that download directly.

For ordinary creation, `CloudCreationUnconfirmedError` means a dispatched request
could not be reconciled. It remains a `CloudSessionError` with code `request_failed`;
hosts should direct users to their session list instead of offering a blind retry.

Use `subscribe` for immutable snapshots and live events, `attach`/`readMessages`
to open a session, and `send` for a follow-up. Attaching a provisioning or failed
session returns its receipt without connecting. `detach` closes this viewer, not
the remote task. Call `dispose` when the host shuts down.
The optional sixth argument to `send` accepts a `beforeDispatch` callback.
The callback runs before submission and can throw to prevent it. A successful
return without `recoveredAfterDisconnect` confirms acknowledgement.
The callback does not confirm acceptance.
`create({ ...input, initialMessage: { text, images } })` creates the task and sends
the first message, returning the session attachment and `initialSend`. Without
`initialMessage`, creation does not send; `initialPrompt` is metadata only.
Retry a failed initial send on the created target only when `dispatched` is `false`.
The Hub continues after viewer disconnects. A lost reply raises `request_failed`;
check cloud tasks before retrying.
Hub clients can publish an approved snapshot before creation with `localGit`.
Pass the `organizationId` returned by `prepareHandoffRepository`, or `null` for Personal.
Omit the preview-only `sourceBranch`, `files`, and `commits` fields from the plan.
This requires token-authenticated workspace access.
Attachments must be image data URLs within the shared media-size limits.
New checkpoint commits are unsigned and skip commit hooks, including pre-commit secret scans.
Pre-push hooks run in the live source checkout and can modify it.
Git supplies the captured commit SHA to those hooks on stdin.
The sensitive-path checks inspect filenames, not file contents.
Publication creates no local branch or tracking configuration.
Remote branches remain if verification or cloud creation fails.
Viewers hydrating active runs with `readMessages` reconcile canonical history at
completion even when they missed the run-start event and earlier content deltas.

`create` accepts `sandboxType: "standard" | "resumable"` (default: `"standard"`).
The controller resumes suspended sessions when opened and restores their saved tasks.

Hosts replacing controllers during credential refresh can share the
`pendingInitialTasks: Map<string, CloudCreationOptions>` constructor option.
It retains first-task approval/thinking/reasoning preferences, including updates
through `restoreCreationOptions`, until the inner task is found or created (or
the outer session is deleted). `dispose` preserves an injected map; without one,
the controller owns and clears its pending state. Restoring options alone never
authorizes recreation of a missing established task.

### Hub-owned cloud viewers

`HubCloudSessionClient` from `@cline/core/cloud` uses an authenticated,
registered `NodeHubClient` from `@cline/core/hub`. Reuse the host's existing
Hub connection, or create and connect a `NodeHubClient` with the Hub URL,
auth token, client ID, and workspace root. The cloud client accepts an async
connection factory and connects lazily; `connect()` explicitly hydrates it.

```ts
import { HubCloudSessionClient } from "@cline/core/cloud";
import type { NodeHubClient } from "@cline/core/hub";

async function openCloudSession(hub: NodeHubClient, sessionId: string) {
  const viewer = new HubCloudSessionClient(async () => {
    await hub.connect();
    return hub;
  });
  const unsubscribe = viewer.subscribe((event) => console.log(event));
  try {
    await viewer.attach(sessionId);
    return await viewer.readMessages(sessionId);
  } finally {
    unsubscribe();
    await viewer.dispose();
  }
}
```

The Hub owns the account-scoped controller, credentials, organization lookup,
provisioning, and sandbox connections. Disposing a viewer releases its subscription
and projected state; admitted cloud work and sandbox connections continue. The
host retains ownership of its shared `NodeHubClient`. Account changes retire the
old controller; Hub shutdown disposes it. Direct controller hosts instead own
and dispose their controller and its connections.

The viewer supports the serializable operations in `CLOUD_HUB_OPERATIONS`,
with arguments/results described by `CloudHubArgs` and `CloudHubResult`.
`CloudHubScope` binds commands to the observed Hub instance and account generation;
callers use the viewer methods rather than constructing RPC envelopes. Snapshot
recovery includes empty sets, removes deleted sessions, and rejects stale revisions.
Dispatched actions are not automatically resent after an uncertain reply.
Handoff callbacks and the sixth `send` lifecycle argument are direct-controller
features and cannot cross this RPC boundary. Hub-backed creation defaults to
`"resumable"` sandboxes.

Hosts with a separate signed-in account can include `expectedAccountId` in the
scope passed to `prepareHandoffRepository`, `listModels`, and `create`. The Hub
rejects a mismatch with its persisted account before running the operation.

Discovery caches, pending listing requests, and newly created fallback rows are
scoped to their organization; switching the sidebar preserves other organizations’
task state without displaying their rows. Discovery’s `timeoutMs` covers both
organization resolution and listing. If the organization is still unknown at
the deadline, discovery returns no cloud rows; cached rows are used only after
establishing their matching organization.

After a successful organization switch, `refreshOrganization()` invalidates the
Hub's cached organization before fetching the current one. A fetch failure leaves
the old cache invalidated. Account-switch success and desktop cleanup must not
depend on this optional refresh; cloud-disabled hosts skip it. A new viewer's
watch also invalidates the cache, covering switches made while the Hub was
unreachable without interrupting existing cloud work.

## Experimental cloud handoff

`loadCloudModels` and `CloudSessionController.listModels()` provide eligible cloud
models. Handoff requires the selected model; it never substitutes another.

Use `create({ handoff, ... })` to provision and seed, or `seedHandoff(id, seed)` for
an existing target. Persist target IDs and dispatch markers through the callbacks;
use `recoverOnly` after uncertain dispatch to avoid duplicate conversations.
Handoff creation requires `onCreating`: durably save intent before returning, and reject a previously unconfirmed intent after restart.
Callback errors preserve their original type; they do not prove an earlier POST was rejected or permit clearing its intent.
`CloudHandoffSeedRejectedError` means no seed was dispatched; clear only the seed marker before retrying the saved target.
`verifyHandoffTranscript` checks the seeded history; `waitUntilReady(id)` waits for provisioning.

## Voice input models

`getLocalTranscriptionModels(providerId, config?)` from `@cline/core` returns the
voice models supported by a provider's transcription transport. Use it to build
voice pickers rather than filtering the bundled chat catalog. Vercel uses its live
model list and advertised streaming tags; unavailable or malformed responses fail
discovery rather than restoring stale bundled models. Voice selection saves and
both batch and streaming execution revalidate through the same service.

`isTranscriptionModel` from `@cline/shared` (also exported for browsers) accepts
exact audio-only input and text-only output modalities. An explicit transcription
label does not override additional input or output modalities. Multimodal live
models are classified as `realtime`, which currently has no built-in transport
support and is excluded from voice and chat pickers. Dedicated transcription can
still use either batch or streaming mode. Classification alone does not prove
that a provider implements the required transport.

`createStreamingAudioTranscriptionSession` mints short-lived Vercel or single-use
ElevenLabs credentials. Its shared response includes `transport` and `sampleRate`;
browser clients must capture PCM at that rate (Google live routes require 16 kHz).
ElevenLabs exposes batch `scribe_v2` and live `scribe_v2_realtime` separately.

## SSH remote environments

`RemoteEnvironmentService` (exported by `@cline/core` and `@cline/sdk`) owns SSH
profiles, connection testing, helper installation, authenticated loopback tunnels,
remote commands, status changes, and cleanup. It runs in the client's Node host;
browser clients expose this API through their host transport. No desktop code is
required. OpenSSH config aliases, identity files, and ssh-agent authentication are
supported. Connections use batch mode and require an already-trusted host key in
OpenSSH known_hosts (or `knownHostsPath`). Before first use, verify the server
fingerprint through a trusted channel and enroll it using your SSH client. Unknown
or changed keys are rejected before inspection, upload, or execution.

```ts
import { ClineCore, RemoteEnvironmentService } from "@cline/core";

const environments = new RemoteEnvironmentService({
  helperBinaryDirectory: "/opt/my-client/remote-helpers",
  onStatusChange: (status) => console.log(status),
});
const profile = await environments.upsert({ name: "Build host", host: "builder" });
const connection = await environments.connect(profile.id);
const core = await ClineCore.create({
  clientName: "my-client",
  backendMode: "remote",
  remote: {
    endpoint: connection.endpoint,
    authToken: connection.authToken,
    workspaceRoot: connection.workspaceRoot,
  },
});
try {
  // The ordinary session, tools, approvals, and event APIs execute on this host.
  // Supply provider credentials in the session config, as for other remote hubs.
  console.log(await core.list());
} finally {
  await core.dispose();
  await environments.dispose();
}
```

The service also exposes `list`, `upsert`, `delete`, `test`, `disconnect`, `run`,
`getConnection`, `getActive`, `activateConnection`, and `getStatuses`.
`onConnectionLost` lets clients retire runtime bindings after a tunnel fails.
Each service instance has a unique remote Hub discovery record, so another
client connecting to the same host cannot stop its Hub.
Connect/disconnect/profile mutations are serialized; concurrent connects reuse
one tunnel. Dispose the `ClineCore` runtime before disconnecting its environment.
Do not expose the connection's authentication token to a browser or logs.

Profiles default to `~/.cline/data/settings/remote-environments.json`, written
atomically with mode 0600. They contain identity-file paths, never private keys.
Options include `profilesPath`, `sshPath`, `knownHostsPath`, process timeouts,
`helperBinaryPath`, and `helperBinaryDirectory`. The corresponding helper/SSH
configuration variables are `CLINE_REMOTE_HELPER_BINARY`,
`CLINE_REMOTE_HELPER_DIRECTORY`, `CLINE_SSH_PATH`, and
`CLINE_SSH_KNOWN_HOSTS_FILE`.

Remote Hubs are CLI-managed. Clients package the self-contained Cline CLI
binary (`apps/cli`, compiled with Bun) for each remote OS and architecture; the
service stages it on the host and runs `cline hub ensure --json --discovery-path
<path> ...` to start or reuse a loopback Hub, and `cline hub stop
--discovery-path <path>` to stop it. Use `remoteHelperBinaryFilename({ platform,
arch })` for the bundled filename (`cline-<target-triple>`). Linux and macOS on
x64/arm64 are supported. The CLI must be built from the same SDK build as the
client; missing binaries produce an explicit error, without installing a
runtime from the network. Agent tools and persistence run remotely; the host
only manages SSH and forwards the authenticated hub connection.

Clients whose own process cannot host the Hub daemon can call
`setHubDaemonLauncher({ command: "/path/to/cline" })` so detached Hubs they
start are launched through the Cline CLI.
The launcher also accepts `args` and child-only `env` overrides. For an Electron
executable, pass `ELECTRON_RUN_AS_NODE: "1"` in `env`. Required Hub daemon markers
take precedence over these overrides.

The hub `/health` endpoint includes `hubId`, the instance identity also returned by authenticated `/status` and discovery. Restart callers can compare it before and after shutdown to distinguish a replacement at the same address from the original hub.

### Provider authentication metadata for host UIs

`@cline/shared` (including its browser entry point) exports `ProviderAuthInfo`,
`ProviderLocalCli`, `resolveProviderLocalCli(provider)`, and
`resolveProviderApiKeyOptional(provider)`. The resolvers accept provider data
(`metadata.localCliCommand` with optional `docsUrl`, and `metadata.apiKeyOptional`);
they perform no registry lookup. Hosts resolve providers through `@cline/llms` and
then pass that data to the shared helpers. `listLocalProviders` includes the
resulting facts in each `ProviderListItem.auth` (`localCli`, and `apiKeyOptional`
for local inference servers and cloud-credential providers that run without a
key), allowing browser clients to render authentication guidance and gate sessions
without importing the LLM catalog. `ProviderListItem.modelTools` likewise
carries provider-level native tool availability for settings indicators.

## Concurrent subagent tool calls

`spawn_agent` and configured `subagent_*` tools declare
`executionMode: "parallel"`. Consecutive calls to these tools in one model
response run concurrently even when the parent runtime uses its default
sequential mode. Each call still returns its child's completed answer, and tool
results remain in the model's original call order.

A tool's optional `executionMode` overrides the runtime's `toolExecution` setting.
Unmarked tools inherit the runtime setting. Sequential calls form ordering
boundaries: `read_file → [spawn A, spawn B] → edit_file` executes the read first,
then both child runs together, then the edit after both finish. This does not
change the execution mode of tools inside the child agents.

Preparation remains serial for the whole response, before any tool executes.
All before-tool hooks and required approvals therefore complete before the
parallel group starts. A before-tool `skip` blocks its own call; a before-tool
`stop` prevents the entire response's execution, as before. Pending approvals
can delay sibling execution. No background-run handles or new concurrency
limit are introduced.

### Configured subagent approvals

Configured agents do not expose a tool approval policy setting. The parent’s
`subagent_<name>` call follows the parent session’s approval policy; the child
executes its available tools without inheriting that policy or approval callback.
Its configured `tools` allowlist and disabled-tool filtering still apply. Runtime
hooks remain inherited and can block tool execution.

## Saving provider credentials

`saveLocalProviderSettings` is asynchronous; callers must await it before
reloading provider catalogs or continuing onboarding. When a saved
provider has a `modelsSourceUrl`, credential, header, and base URL updates refresh
its model list before saving the new settings. `updateLocalProvider` follows the
same rule even when the request omits `models` and `modelsSourceUrl`. Endpoint
changes relocate same-origin model sources; separate catalog origins remain
unchanged. Model refresh in `saveLocalProviderSettings` is best-effort: if it
fails during discovery, the new settings are still saved and the last known
catalog is retained. Settings and catalog persistence errors still reject the save.
Provider-service mutations are serialized per catalog file within the process,
including across manager instances and different providers. Discovery prepares
the update before the complete settings patch is persisted once. If the catalog
write fails, the prior provider settings are restored only while the failed
operation still owns the current settings entry; newer saves and removals are
preserved. A rollback failure is reported alongside the original error.
Explicit `updateLocalProvider` calls still reject failed model fetches and retain
the prior settings and catalog.

Catalog refreshes replace discovery-owned model IDs while retaining manually
added models, their default selection, and overrides on retained model entries.
`models.json` records discovery-only IDs in `discoveredModelIds`; IDs also supplied
explicitly are user-managed. An explicit `models` update replaces the manual list.
An existing model selection in provider settings does not count as a manual
addition when initializing a source-backed catalog.
Provider capabilities are inherited when registering models, so stored per-model
capability overrides continue to take precedence after refreshes.

## Shared UI session rows

`@cline/ui` exports `AgentSessionRow`, `AgentSessionRowEditor`, and
`AgentSessionOverview`, together with their public props types. These are
presentation primitives for session navigation, rename, and metadata content;
the host retains session data, routing, menus, permissions, formatting, and
interaction policy. Import the shared component stylesheet with the host theme.

`AgentSessionRow` owns the row geometry, selected/hover appearance, timestamp
placement, and pending/provisioning/running/unread status-dot precedence. Hosts
provide the already-formatted `label` and `timestamp`, optional `leading` and
`pinnedIndicator` content, and a sibling `action`. Root DOM props and refs pass
through to the row wrapper for host-owned context-menu or hover-card triggers.

The default control is the desktop native `button`; its `disabled` and
`onSelect` props apply only in that mode. URL or router navigation uses the
mutually exclusive `renderControl` mode, which receives the shared navigation
`className` and row `children` for the host's link or router control. The host
control owns its href, accessibility, disabled behavior, and event handling.
The control union prevents combining `renderControl` with `disabled` or
`onSelect`, and keeps optional actions as siblings so interactive elements are
not nested.

`AgentSessionRowEditor` supplies the matching edit frame while the host owns
the rename input, focus, Enter/Escape/blur handling, and saving state.
`AgentSessionOverview` renders a title and `[label, value, fullValue?]`
metadata rows; the host owns the hover-card lifecycle, positioning, and
metadata formatting. See the [session-row adoption guide](./packages/ui/ADOPTION.md#session-rows)
for the import, slot, and trigger/ref examples.

## Shared context usage presentation (`@cline/ui`)

`AgentContextUsage` exposes desktop's context ring and token breakdown through
its `children` render callback. It adds no wrapper: the host receives
`AgentContextUsagePresentation` (`triggerLabel`, `ring`, and `details`) and keeps
its own accessible trigger, popover, positioning, focus, and keyboard behavior.

`AgentContextUsageProps` accepts `usage: AgentContextUsageData`, optional
`costLabel: ReactNode`, and the required render callback. Usage contains
`tokensIn`, `tokensOut`, `cacheReadTokens`, and optional `contextWindow`.
Supply current-request metrics and the model's authoritative context capacity,
not accumulated session token traffic. The component renders nothing when
usage is empty or context capacity is unavailable or nonpositive. Cached tokens
are part of input usage, not additional context consumption.

`costLabel` is a separate host-formatted cost. Numeric zero is displayed;
previously hidden falsy values remain omitted. Desktop retains its existing
cost formatter and usage source. Import the component and all three public
types from `@cline/ui`; see [UI adoption guidance](packages/ui/ADOPTION.md) for
theme setup, styling, and composition examples.

## Shared command output and image presentation (`@cline/ui`)

`AgentCommandOutput` renders `output` with a running cursor controlled by
`isRunning`. Optional `children` let the host retain ANSI rendering or normalize
control characters. It follows new output initially, pauses when the user
scrolls away, and resumes within 24px of the bottom. Hosts own output collection,
limits, and session identity; remount it when switching commands. `tabIndex` and
`classNames.viewport` / `classNames.cursor` allow host-specific accessibility styling.

`AgentImageLightboxContent` renders an image and two close controls calling
`onClose`. The host owns the dialog, positioning, Escape handling, focus management,
and image navigation. `backdropTabIndex` can exclude the backdrop from a managed
dialog's tab order. Image source validation and resolution remain host-owned;
provider-generated URLs must go through an explicit host trust policy before
rendering. This presentation primitive does not replace `GeneratedMediaContent`
or its inline-byte validation.

## Shell executor errors

The executor returned by `createShellExecutor` rejects on execution failure.
The following error classes are exported from `@cline/core` so hosts can
distinguish process outcomes without parsing messages. They are not an exhaustive
list of rejections: cancellation, timeout, and stdin-write failures can reject
with other errors.

- `CommandExitError` — the shell started and exited non-zero. `exitCode` is the
  numeric process exit code and `output` contains a completion notice and the
  captured output (subject to the configured truncation limit).
- `CommandTerminationError` — the process terminated without a numeric exit
  code. `signal` is the terminating signal, or `null` if none was reported;
  `output` contains a termination notice and the captured output. This error
  has no `exitCode` field.
- `CommandSpawnError` — the shell process could not be started, so there is no
  exit code. The message keeps the pre-existing `Failed to execute command: …`
  form. `code` is the operating system error libuv reported (`ENOENT`,
  `EACCES`, `EFTYPE` for a file that is not a valid executable). Because spawn
  reports `ENOENT` with the same message when the executable is not found and
  when the working directory no longer exists, `missing` records which path was
  absent at failure time: `"executable"` or `"cwd"`. It is `undefined` for every
  other code. `code` itself is `undefined` if the underlying error has no code.

The public `run_commands` tool catches executor failures and resolves with
per-command results containing `success: false`, rather than propagating these
errors as rejected tool calls. For `CommandExitError` and
`CommandTerminationError`, the failed result retains `output` in its `result`
field. For `CommandSpawnError`, `result` is empty and `error` includes the spawn
failure message. Hosts that need the structured error fields must observe the
executor rejection before this conversion.

Hosts that record command telemetry should label a `CommandSpawnError` by its
`code` (and `missing`) rather than inventing an exit code. The VS Code and
standalone adapters do this in the `errorCode` dimension, and use the bounded
labels `signal` and `no_exit_code` for `CommandTerminationError`. Only an actual
numeric exit is reported as `exitCode`.

## Tool success context

`AgentTool` and `createTool` accept optional `successContext` text. The agent runtime appends it after the iteration’s tool results, once after-tool hooks have run, without changing the tool output. It reaches the model as a user-role context message with `displayRole: "system"`, hidden from client transcripts. Errors, skipped calls, and hooks that stop execution do not add it. It is retained as conversation history and remains subject to context compaction.

`createAskQuestionTool` and the question tool from `createDefaultTools` use this field to remind the model to continue after an answer, in both direct `Agent` and `ClineCore` sessions.

## Symlinked instruction files

Rules and workflows can be symbolic links to regular files. Source paths and
fallback names use the link's name and location, not the target's. Broken,
circular, and non-file targets are skipped.

`UnifiedConfigFileWatcher` watches only the directory containing the link, not
the link's target. Edits to a symlink's target are picked up on the next
refresh or new session.

## Unknown model completion recovery

The AI SDK adapter maps unified `length` to `max-tokens` and missing or unrecognized reasons (including `other`) to `unknown`. Explicit `stop`, `tool-calls`, `content-filter`, and `error` retain their meanings. The agent also treats a stream without a finish event as unknown.

Without tool activity, an unknown response is preserved in history and continued once, with the model-visible user message “Previous turn ended unexpectedly. Continue from where you left off.” The message uses `displayRole: "system"` and `userRunSpan: 0`, matching injected hook context so it stays out of live and replayed chat transcripts. The system prompt is unchanged. A second unknown completion fails the run. Queued user instructions are consumed before the continuation, including in the first iteration. Tool calls receive their results through the normal loop; provider-executed actions are not replayed.

## Host connector transport

Pass `connectorsRequest: (path, init) => Promise<Response>` to `LocalRuntimeHost`
and `createLocalHubScheduleRuntimeHandlers` to supply connector authentication.
Paths start with `/api/v1/connectors`; the host supplies the API origin and
authentication. Omit it to retain local account authentication and rollout checks.

## MCP Apps (experimental)

MCP Apps support is off by default.
`createDefaultMcpServerClientFactory({ mcpApps: true })` turns it on by
advertising the `io.modelcontextprotocol/ui` extension (`MCP_APPS_EXTENSION_ID`)
with the `text/html;profile=mcp-app` MIME type during `initialize`, for stdio
and URL servers alike.

`createMcpTools` always leaves out tools whose `_meta.ui.visibility` does not
include `"model"`, whether or not the client advertised the extension.

Tool descriptors keep the server's `_meta`. `getMcpAppToolMeta` reads
`_meta.ui`: `resourceUri` is kept only for `ui://` URIs, and `visibility`
defaults to `["model", "app"]` when it is not an array. An explicit array is
used as given after dropping unknown entries, so `[]` makes the tool visible to
neither. `isMcpToolVisibleToModel` and `isMcpToolVisibleToApp` check those
lists; a host must reject app-initiated tool calls when
`isMcpToolVisibleToApp` is false.

`McpManager.readResource({ serverName, uri, context })` sends `resources/read`
and returns `{ contents, _meta? }`, validated against the MCP SDK schema;
malformed replies throw. It is optional on `McpManager` and
`McpServerClient`. `InMemoryMcpManager` reads without waiting for in-flight
tool calls on an already connected server. A read that starts while the server
is being disconnected or re-registered can fail with a disconnect error; retry
it.

For sessions, set `mcpApps: true` in the session config (`CoreRuntimeFeatures`).
The runtime builder then advertises the extension to every settings and Agent
Plugin MCP server it connects, and the session gains an MCP Apps runtime that
uses those same connections. Hosts reach it through `ClineCore`:

- `resolveMcpAppTool(sessionId, toolName)` maps an agent tool name (as it
  appears in tool events, for example `weather__show_weather`) to
  `{ serverName, toolName, resourceUri }`. It returns `undefined` for tools with
  no `ui://` resource, for sessions without MCP Apps, and for runtimes or hub
  daemons that do not support MCP Apps.
- `readMcpAppResource(sessionId, { serverName, uri })` reads a `ui://` resource
  from one of the session's MCP servers. Other URI schemes are rejected.
- `callMcpAppTool(sessionId, { serverName, toolName, arguments })` calls a tool
  on the app's behalf. It rejects tools whose visibility lacks `"app"`, tools
  the server does not list, servers outside the session, and tools the session
  disables through `toolPolicies` or the global `disabledTools` setting (matched
  by agent tool name, such as `weather__refresh_view`). App calls are recorded
  as tool usage telemetry, but do not request tool approval and do not run tool
  hooks; a host that wants consent must ask before calling.

Reads and calls reach every enabled settings and Agent Plugin server, including
ones that failed to list tools at startup; the manager reconnects on demand.
`resolveMcpAppTool` only searches servers that loaded tools at startup, since
the agent can only call tools from those. Neither method checks which server an
app came from, so a host bridging app requests must pass the `serverName` from
the app's `resolveMcpAppTool` binding rather than one the app supplies.

`readMcpAppResource` and `callMcpAppTool` throw when the session was started
without `mcpApps` or has no MCP servers. Hub-backed hosts send these as the
`session.mcp_apps.*` commands, so the hub daemon serves them from the session's
own MCP manager.

## Run stall telemetry

`@cline/core` measures stalls with a `RunHealthObserver`
(`packages/core/src/services/telemetry/run-health.ts`). `SessionRuntime`
creates one per run, for root agents and subagents, when telemetry is
configured. It watches only the run's runtime events and is disposed when the
run returns.

- `task.run_idle` fires at most once per run, while it is still running and has
  emitted no runtime event for 60s.
- When the run ends, `AgentRuntime` calls the optional
  `AgentRuntimeConfig.runEndTelemetryProperties()` once, while capturing
  `agent.run-finished` or `agent.run-failed`, and merges the result into that
  event. Core uses it to add `maxIdleMs`, `maxIdleAfter`, `msSinceLastEvent`,
  `lastEventType`, `finishReason`, `idleReported`, `endedOn` and
  `textSignature`. The observer stops its idle check at that point.
- `tool-call-delta` is a runtime event emitted for each streamed tool-call
  argument chunk. It carries no arguments and exists so that a slow tool-call
  stream is not mistaken for a silent one. It is not mirrored to telemetry and
  is not forwarded as hub hook traffic.

No message text leaves the client: `textSignature` and `session.input_sent`'s
`bumpKind` are enums computed locally
(`packages/core/src/services/telemetry/stall-signals.ts`).

### UX verification report renderer

`@cline/shared/browser` exports `UxVerificationReportSchema`, `UxVerificationCheckSchema`, `UxScreenshotSchema` and their types. A report contains a title, environment subtitle and ordered checks with unique IDs, passed/failed/blocked statuses, observations and optional action labels. Passed/failed checks require screenshot evidence. This contract describes presentation independently of how checks are run.

`@cline/ui` exports `AgentUxVerification` with `output` and `state` (`running`, `completed`, `error`). It validates the report and renders screenshot evidence, derived status counts, titles, observations, thumbnails and optional slideshow. Left/Right switch slides and pause playback; Space toggles playback while the carousel itself has focus. Import `@cline/ui/components.css` for styling.

Native inline screenshots use validated browser-owned Blob URLs and show a fallback on load errors. Hosts supply `renderScreenshot(check, className, presentation)` for trusted remote or authenticated asset references, including retrying signed URLs only after a fetch error; the renderer performs no URL refresh or transport. Hosts supply `onExpandScreenshot(check)` to open their own image viewer. No producer tool, subagent lifecycle, storage format, CLI projection or product transcript policy is part of this component.

UX verification screenshots reuse canonical `GeneratedMedia` with `modality: "image"` and the supported raster media types. `source` supports inline `base64`, trusted host-resolved `url`, or stable `artifact` references. The screenshot's `id`, optional `name`, and `sizeBytes` are preserved. Hosts can pass screenshots directly to an existing generated-media/artifact renderer; there are no separate top-level `data` or `url` screenshot fields. Signed access URLs remain transient host state when using artifact references.

UX screenshot renderers receive `presentation: "slide" | "thumbnail"`. Thumbnail rendering must be non-interactive, so hosts should keep retry controls in the main image and expanded view only. The shared generated-media renderer handles native image load failures, so expanded inline evidence also shows an unavailable state.
