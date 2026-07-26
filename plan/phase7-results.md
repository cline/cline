# Phase 7 Clean-Core Stabilization Results

## Status

The implementation, clean build, focused tests, runtime audit, VSIX audit, and
clean-profile installation/activation checks pass.

Phase 7 remains environmentally blocked at the live Bedrock gate. This machine
has no AWS environment credentials, shared credentials/config files, SSO
cache, web-identity credentials, or container credentials. The AWS SDK default
chain returns `CredentialsProviderError`. A real streamed response and
in-flight live cancellation therefore could not be verified. No
`bedrock-clean-core-v0` tag was created.

## Baseline

- Commit: `efd4196da4430b2e06ba1059aa186a83ff5f8a5b`
- Branch: `bedrock-minimal`
- Starting working tree: clean
- Tracked files: 1,441
- Counted source files: 1,160
- Physical source lines: 220,127
- Nonblank source lines: 199,627
- Production VSIX: `apps/vscode/dist/phase6-smoke.vsix`
- Baseline VSIX size: 6,245,012 bytes
- Baseline extension bundle size: 15,846,910 bytes
- Baseline clean-profile activation: 103.354 ms

The source-line method counts physical and nonblank lines in Git-tracked
`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.css`, `.scss`, and `.proto`
files below `apps/vscode` and `sdk/packages`. Generated files are included when
tracked; build output and dependencies are not.

## Final Measurements

- Tracked files: 1,443
- Counted source files: 1,161
- Physical source lines: 219,878
- Nonblank source lines: 199,413
- Production VSIX: `apps/vscode/dist/phase7-smoke.vsix`
- Final VSIX size: 6,283,820 bytes
- Final extension bundle size: 15,846,960 bytes
- Definitive isolated-profile activation: 397.125 ms
- Definitive webview resolution: 6.591 seconds after the activation log

Measurements are informational. The final VSIX was packaged from the completed
Bun production build through the locally installed VSCE pack API with
dependency discovery disabled, avoiding VSCE's npm-only prepublish wrapper.

## Clean Build and Package

A detached disposable worktree at the Phase 6 commit was populated with the
current source snapshot. It did not use build output from the primary checkout.

- `bun install --frozen-lockfile`: passed; 1,714 packages installed
- `bun run build:sdk`: passed for `@cline/shared`, `@cline/llms`,
  `@cline/agents`, and `@cline/core`
- `apps/vscode: bun run check-types`: passed
- `apps/vscode: bun esbuild.mjs`: passed
- `apps/vscode: bun run package`: passed
- Bun-built VSIX packaging: passed; 28 files

The proto lint command was made platform-independent. It now compares each
file with local Buf formatter output rather than depending on a global Unix
`diff` executable. The one unformatted proto was corrected.

## Focused Verification

The Phase 7 fixes and retained boundaries have 368 focused passing assertions:

- Bedrock runtime, shared transport, default/profile credential behavior, and
  sanitized errors: 9
- Context compaction and direct Bedrock summarizer factory: 56
- Approval routing and fail-closed policy: 27
- Diff/edit review and task control: 32
- Plan/Act configuration and mode switching: 26
- Session event, start, lifecycle, compaction, MCP, and terminal-mode behavior:
  67
- Bedrock model error translation: 110
- Terminal acquisition/abort/listener cleanup: 3
- Hub boundary and child-agent provider inheritance: 31
- Agent approval, usage, and abort behavior: 3
- History, resume, and persisted usage: 4

One broader exploratory run of `vscode-run-commands-tool.test.ts` produced 36
passes and six 20-second timeouts in the detached "proceed while running"
Windows terminal cases. Those cases are outside the Phase 7 approval and abort
fixes. The three focused terminal approval/cancellation cases pass.

## Clean-Profile Product Check

The final VSIX was installed into new isolated VS Code user-data and extension
directories. `CLINE_DIR` and `CLINE_DATA_DIR` were also redirected to an empty
disposable location so no user MCP, history, or settings data could load.

- Installation: passed
- Activation: passed
- Bedrock SDK adapter and gRPC bridge initialization: passed
- Cline sidebar webview resolution: passed
- ClineCore plus VS Code tool host initialization: passed
- Visual render: passed; the empty-workspace sidebar displayed its welcome
  state
- Missing module/RPC/contract errors: none in the extension log
- Extension-specific startup errors: none

The Node `url.parse()` deprecation warning comes from the VS Code/packaging
runtime and is retained as an environmental warning.

## Core Smoke Matrix

| Area | Result |
|---|---|
| Activation | Pass in the definitive isolated profile |
| Webview | Pass; sidebar rendered and session host initialized |
| Settings | Pass by runtime/source inspection; `ApiOptions` exposes only `BedrockProvider` plus retained local settings |
| Authentication | Blocked; no valid AWS environment/profile/SSO session is available |
| Bedrock stream | Blocked by unavailable credentials |
| Usage | Pass in focused Bedrock, agent-runtime, and persisted-history coverage |
| Cancellation | Unit/transport path passes; live in-flight cancellation blocked by unavailable credentials |
| Plan mode | Pass; state-changing tools remain unavailable/prohibited |
| Read/search | Pass; read-only policy allows bounded reads/searches without approval |
| Edit | Pass; edit requests route through explicit approval and reviewable diff coordination |
| Terminal | Pass; commands route through explicit approval and terminal enablement |
| History | Pass; SDK and legacy history/resume paths remain readable |
| Local logs | Pass; AWS code/request ID survive sanitization while raw credential-like details are redacted |

## Runtime Boundary Audit

- `createBedrockClient` is the only public client factory. The one-item
  `createHandler` and `createHandlerAsync` wrappers were removed.
- Plan, Act, restored sessions, and configured child agents retain
  `providerId: "bedrock"`. A configured-agent test deliberately supplies
  `providerId: openai` and proves it is ignored while the Bedrock connection is
  inherited.
- The default AWS credential-provider chain resolves at runtime. Persisted
  settings contain only model, region, optional profile, HTTPS endpoint, and
  CA-bundle path.
- Region, endpoint, credential chain, and CA-bundle transport share the Bedrock
  vendor boundary.
- Request `AbortSignal` reaches `streamText`, and focused cancellation tests
  pass.
- Bedrock errors preserve an allowlisted AWS error code and request ID without
  logging the raw provider error.

## VSIX Audit

- Production entry point exists: `extension/dist/extension.js`
- Webview entry point and seven runtime assets exist
- All 14 contributed commands map to retained registry commands or the two
  explicitly development-gated local commands
- Required bundled evidence: 249 Bedrock matches, 74 `@aws-sdk` matches, 598
  MCP matches, 237 plugin matches, and 236 approval matches
- Source maps: 0
- Test/spec files: 0
- Webview development configs and Storybook files: 0

Intentional textual matches:

- `clinePass`, billing, subscription, auto-approval, and YOLO names exist only
  in destructive migration lists that strip obsolete retained user state.
- Non-Bedrock provider names in the state-manager regex exist only to identify
  and remove obsolete stored keys.
- Anthropic and Mistral model-name checks describe models hosted through
  Bedrock; they are not provider clients.
- `@opentelemetry/api` is an internal dependency of the retained Vercel AI SDK.
  No exporter, remote telemetry endpoint, or telemetry initialization is
  present.
- VS Code Marketplace publishing metadata and third-party license text are
  intentionally retained.

The obsolete unregistered `cline.reconstructTaskHistory` package contribution
was removed, and webview TypeScript/config/Storybook inputs are excluded from
the VSIX.

## Required Follow-up

Repeat the live smoke with a valid temporary AWS environment or authenticated
profile session:

1. stream one small Bedrock response;
2. confirm returned usage is recorded;
3. cancel one in-flight stream and confirm the chat remains usable;
4. inspect the isolated local log for redaction;
5. only then create the annotated `bedrock-clean-core-v0` tag.
