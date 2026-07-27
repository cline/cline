# Phase 13 Release Qualification Results

Date: 2026-07-26

Baseline commit: `4a965bbd9b8de7afefe4a601a03e0c0287233cd4`

Qualified source commit: `879998fddbbb79234cf099f6f8666c43e7052a07`

## Outcome

Phase 13 produced an installable, activating corporate-safe release candidate
with a centralized data-egress policy, a checked egress/process inventory,
guarded receive-oriented public research, removed webhook and remote-MCP
connection paths, deny-by-default executable capabilities, redacted logging,
an SBOM, current-tree/history secret scanning, and deterministic archive
inspection.

The candidate is **conditionally qualified, not approved for unrestricted
corporate release**. Final sign-off still requires the dependency-vulnerability
audit to be authorized and the environment-specific baseline test failures to
be dispositioned. Live Bedrock acceptance and packet/proxy capture also require
the target corporate environment and credentials.

## Exact QA Artifact

- VSIX: `apps/vscode/dist/bedrock-coder-0.1.0.vsix`
- Size: `9,907,618` bytes
- SHA-256:
  `29b7e3d17059e98827ae4c5642c25eda6bcf95e9c581f22b25e998acc9973640`
- Checksum sidecar: `security/bedrock-coder-0.1.0.vsix.sha256`
- CycloneDX 1.5 SBOM: `security/bedrock-coder.cdx.json`
- SBOM SHA-256:
  `479166c6215c9fdadf5faa4a37b7d3357838ae0c6385ca7c3d74d9b38db2a651`
- SBOM coverage: 1,606 Bun lock components; 1,447 have locally available
  declared-license metadata. Optional/platform packages not materialized on
  this Windows ARM64 host remain identified by package URL and integrity.
- Egress registry: `security/egress-registry.json`

The retained VSCE packager produced 21 entries. The archive check confirmed
the `fffalexgo.bedrock-coder` identity, `./dist/extension.js` entry point,
LICENSE and NOTICE, no source maps or source tree, no bundled dependency tree,
no high-confidence secret pattern, and no prohibited webhook, hosted-model,
link-preview, or remote-MCP constructor marker.

## Implemented Security Boundaries

- Added the `PUBLIC`, `WORKSPACE_SENSITIVE`, `SECRET`, and `UNTRUSTED_WEB`
  provenance classes and an explicit sink matrix. Only Bedrock inference may
  receive workspace-sensitive data; Bedrock does not receive `SECRET`.
- Public research permits only HTTP(S) GET/HEAD with fixed minimal headers, no
  caller headers/body/cookies/credentials/referrer, manual redirect
  revalidation, standard ports, DNS/IP private-range denial, response
  type/size/time limits, and metadata-only audit events.
- Sensitive paths, code-shaped input, credentials, encoded payloads, and
  workspace content are rejected from URL hostnames, paths, and query values.
- Removed the webhook implementation and `/lg-task` URI installation path.
- Removed remote MCP add/auth RPCs and UI, OAuth transport manager, SSE/HTTP
  constructors, reconnect handler, test server, and SDK OAuth implementation.
  Existing remote config shapes can be parsed only so the UI can show a local
  blocked diagnostic; connection factories cannot create a network client.
- Link previews and image detection no longer contact remote destinations.
  URL mentions use the central guarded research request rather than a browser.
- Terminal tools, external browser navigation, and executable hooks/plugins
  default to disabled. Local stdio MCP remains available only as explicitly
  trusted local code and is warned as capable of independent networking.
- Removed shell/browser fallbacks from GitHub link opening. The guarded VS Code
  external-navigation host is the only path and is disabled by default.
- Logging now redacts credential patterns, bearer values, sensitive named
  fields, commands, output, prompts, and workspace paths; arbitrary argument
  objects are never serialized.
- A checked registry covers 41 production files containing network, AWS,
  browser, terminal, process, or external-navigation sink signatures. New or
  count-changed callsites fail `bun run check:egress`.

## Verification Evidence

Environment:

- Bun `1.3.13`
- Node `v24.13.0`
- VS Code `1.130.0` (`arm64`)
- Windows, PowerShell, America/Toronto

Passed:

- `bun install --frozen-lockfile` — 1,464 installs / 1,607 packages, no changes.
- `bun run build:sdk`.
- `bun run check-types` in `apps/vscode`.
- `bun run package` in `apps/vscode`, including identity, egress registry,
  type compatibility, webview build, lint, proto lint, and production bundle.
- Corporate egress + remote-MCP policy tests — 11/11.
- MCP configuration webview test — 1/1.
- VS Code unit suite relevant results — 585 passed. Both new Logger tests,
  three URI tests, five MCP delete tests, sixteen MCP update tests, and fourteen
  MCP schema tests passed.
- `security/check-secrets.mjs` — 1,422 current-tree files and patches from
  6,652 commits; no high-confidence secret remained. Exact reviewed historical
  allowlists cover only documented synthetic test fixtures.
- VSIX inspection — 21 entries passed identity, contents, marker, and secret
  checks.
- Fresh isolated-profile install — `fffalexgo.bedrock-coder@0.1.0`.
- Exact post-commit VSIX activation — 58.051 ms. The local extension log
  records `Terminal tools are disabled by the corporate-safe default`.

Isolated activation evidence is under the ignored local directory:
`.phase13/postcommit-profile/user-data/logs/20260726T224224/`. Cold startup
attempted only the expected Bedrock credential-resolution state machine and
ended in a local `failed` state because the isolated profile had no configured
AWS credentials. No task/project content existed in that profile.

## Open Gates and Known Limitations

1. `bun audit` could not run in the restricted environment. The external audit
   request was denied because it would disclose the dependency graph to the
   registry vulnerability service without explicit user authorization. No
   alternative external upload was attempted.
2. Core unit suite: 832 passed, 10 failed, 5 skipped, plus one import-time
   failed suite. Failures cover pre-existing Windows/search-path, plugin
   sandbox/loader, checkpoint expectation, team-recovery expectation, hook
   export, and Bedrock settings migration behavior; none touch the Phase 13
   egress implementation. They still require owner disposition before release.
3. VS Code unit suite: 585 passed, 2 failed. Both failures are skill discovery
   count expectations affected by the repository's real `.agents/skills`
   directory. All security-relevant changed tests passed.
4. No live Bedrock chat/tool acceptance was run because the isolated profile
   had no corporate AWS credentials. SSO/proxy/custom-CA success and error
   behavior must be validated in the target network.
5. No packet capture or enforced corporate proxy was available. The static
   registry, bundle inspection, guarded-request tests, and isolated logs are
   evidence, but a target-environment traffic capture is still required for
   cold-start and representative-session release sign-off.
6. Public research is policy-guarded in-process, but absolute containment of a
   trusted local MCP executable, an enabled terminal, or an enabled executable
   plugin requires an organization-managed OS/container/proxy sandbox.
7. The VSCE tool invokes the manifest's prepublish command through its npm
   launcher; that prepublish command itself executes the Bun-only build. No npm
   dependency installation was performed.

## QA Handoff

Before corporate release:

1. Verify the VSIX SHA-256 above before installation.
2. Review `security/egress-registry.json` and the CycloneDX SBOM.
3. Explicitly authorize and run the dependency vulnerability audit, or run it
   inside the organization's approved private advisory service.
4. Run the failed baseline tests in the supported CI image and disposition each
   mismatch.
5. Install the exact VSIX in a clean managed profile, configure the approved
   Bedrock region/profile, and execute the Phase 13 acceptance matrix.
6. Capture DNS/proxy/packet evidence for cold activation and a representative
   session, confirming only Bedrock/AWS/public-research traffic allowed by the
   registry and no fallback destination after denial.
