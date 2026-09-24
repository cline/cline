
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

## Cloud sessions (experimental)

`CloudSessionApi` and `CloudSessionController` are exported from `@cline/core/cloud`.
The API handles REST requests; the controller handles remote Hub connections,
session lifecycle, transcript reconciliation, and approvals. Hosts provide API
URLs and a fresh-token callback; feature gating and account selection stay in the
host. Importing this subpath does not start a local agent.

Use `subscribe` for immutable snapshots and live events, `attach`/`readMessages`
to open a session, and `send` for a follow-up. Attaching a provisioning or failed
session returns its receipt without connecting. `detach` closes this viewer, not
the remote task. Call `dispose` when the host shuts down. This foundation does
not include local-to-cloud handoff.
Viewers hydrating active runs with `readMessages` reconcile canonical history at
completion even when they missed the run-start event and earlier content deltas.

Hosts replacing controllers during credential refresh can share the
`pendingInitialTasks: Map<string, CloudCreationOptions>` constructor option.
It retains first-task approval/thinking/reasoning preferences, including updates
through `restoreCreationOptions`, until the inner task is found or created (or
the outer session is deleted). `dispose` preserves an injected map; without one,
the controller owns and clears its pending state. Restoring options alone never
authorizes recreation of a missing established task.

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

Clients package a matching self-contained helper using the
`@cline/core/remote/helper-entry` executable entrypoint, compiled with Bun for the remote OS and
architecture. Use `remoteHelperBinaryFilename({ platform, arch })` for the
filename (`cline-remote-helper-<target-triple>`). Linux and macOS on x64/arm64
are supported. Helpers must include the same SDK build as the client; missing
helpers produce an explicit error, without installing a runtime from the network.
The helper implements `--remote-hub-ensure --cwd <path> --discovery-path <path>`
and the core detached-daemon sentinel. Agent tools and persistence run remotely;
the host only manages SSH and forwards the authenticated hub connection.


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
