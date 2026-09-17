
## Experimental cloud session client

Import `CloudSessionApi`, `CloudSessionController` and cloud DTOs from
`@cline/core/cloud`. This surface is intentionally absent from the root barrel.

Construct the API with `apiBaseUrl`, `appBaseUrl`, and a refresh-aware `getAuthToken`.
Construct the controller with that API, `apiBaseUrl`, the same token resolver, and
`getActiveOrganizationId`. Hosts must recreate their client on identity/scope changes.
`clientIdentity` identifies the viewing host; `lateCreateDisposition: "preserve"`
keeps late successful creations recoverable when the viewer has closed.

- `create(input)` creates an outer sandbox; it does **not** send `initialPrompt`.
- `attach(id, creationOptions?)` connects; `readMessages(id)` hydrates the authoritative
  transcript and queue. Restore an explicit approval policy for a recovered fresh sandbox.
- `getSnapshot(id)` and `subscribe(listener, id?)` expose copied, frozen state including
  `messages`, `promptsInQueue`, `approvals`, `busy`, `connectionState`, and `transcriptKnown`.
- `prompt_accepted` confirms dispatch from a matching Hub request ID and client ID, or
  the successful command reply, before a long-running `send()` resolves. Hosts can retire
  saved drafts at that point without confusing accepted work with an uncertain send.
- Turns started by another viewer hydrate the transcript on first progress and at
  completion, using the same buffered reconciliation as reconnects.
- `send`, `abort`, `updatePendingPrompt`, and `removePendingPrompt` operate on cloud IDs.
- `respondApproval(id, approvalId, {approved})` answers a server-owned approval. Detach,
  viewer dismissal, or another viewer's response never imply rejection.
- `detach(id)` / `dispose()` close viewing connections without aborting hosted work.
  `delete(id)` is a separate destructive action.
- `api.recoverCreation(input)` locates a creation by its stable request marker without
  issuing a new POST. Hosts must retain ambiguous outcomes and require explicit resend.

`CloudHandoffCoordinator` orchestrates local-to-cloud transfer. Supply a
`CloudHandoffSource` adapter, cloud controller, live model loader, scope key,
availability check, and optional progress handler. Call `prepare()`, display its
repository/branch/model (including any fallback), then pass that result to
`execute()`. The coordinator revalidates the source and returns the verified outer
session ID, which the host can attach. It does not send a follow-up prompt.

Lower-level `create({handoff, ...})` persists the outer ID through the host callback
before resolving source messages and creating the seeded Hub session.
`seedHandoff(id, seed)` resumes a known workspace; `verifyHandoffTranscript` checks
the authoritative read-back. Hosts must durably record `onSeeding` before it returns
and set `recoverOnly` after an unconfirmed seed dispatch. That mode adopts only a
matching existing source conversation and refuses to create a replacement.

`createHubEventProjector(onEvent)` maps reconciled Hub envelopes to session events.
Call `reset(sessionId)` when replacing an authoritative transcript baseline and
`dispose()` when the viewer closes. This mapper never executes tools or answers approvals.

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
