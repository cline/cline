
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
