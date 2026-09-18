
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
