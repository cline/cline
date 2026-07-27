# Phase 13 Handoff: Release Qualification and Corporate Data-Egress Security

## Goal

Produce, install, and verify a complete Bedrock Coder release candidate, then
audit and harden the entire codebase so project code and other sensitive
workspace data can be sent only to the configured Amazon Bedrock inference
destination.

Bedrock Coder may search and read public websites to answer questions. Online
research must be receive-oriented: external sites may receive only the minimum
sanitized URL or search query needed to retrieve public information. They must
never receive workspace code, file contents, prompts, tool output, credentials,
local paths, logs, checkpoint content, or conversation history.

After security remediation, rebuild and retest a second, final VSIX. The final
artifact—not the initial release candidate—is the artifact handed to the user
for QA on the other computer.

Repository:

```text
https://github.com/FFFalexgo/AWS_Bedrock_Coder
```

Local repository:

```text
C:\Coding\cline_aws
```

Prerequisite: Phase 12 is complete and committed. Read `plan/scope.md`,
`plan/phase12-results.md`, this handoff, and applicable `AGENTS.md` files before
editing.

## Security Bottom Line

### Data allowed to reach Bedrock inference

The selected Bedrock model may receive the information required for coding:

- user prompts;
- explicitly included workspace files and code excerpts;
- search results from the local codebase;
- tool results selected for model context;
- diffs, diagnostics, and terminal output selected for model context;
- conversation context.

The UI must make it reasonably clear that this project context is being sent to
the selected Bedrock model or inference profile.

### Data allowed in public web research requests

Public web destinations may receive:

- a short sanitized search query that contains no workspace-derived data;
- an HTTP or HTTPS URL selected for navigation or retrieval;
- ordinary protocol metadata such as IP address, TLS metadata, and a generic
  user agent.

Public web research responses may be read and returned to Bedrock for analysis.

### Data prohibited from non-Bedrock destinations

Do not send any of the following to public websites, remote MCP servers,
webhooks, analytics services, update services, hosted catalogs, plugin
services, or other third parties:

- source code or file contents;
- workspace-relative or absolute paths;
- repository metadata not deliberately made public;
- prompts, conversations, model responses, or system prompts;
- tool parameters or tool results;
- terminal output;
- diffs, diagnostics, checkpoints, or history;
- AWS credentials, session tokens, SSO tokens, OAuth tokens, secrets, cookies,
  authorization headers, or custom CA private material;
- hashes or fingerprints derived from sensitive workspace content when they
  could identify that content.

Redaction is not sufficient for a destination that has no business reason to
receive the data. Do not transmit the payload.

## Allowed Network Destinations

### AWS service traffic

Allow only the AWS traffic required by retained functionality:

- configured Bedrock runtime endpoints;
- Bedrock control-plane endpoints for model and inference-profile discovery;
- AWS STS and SSO endpoints required by the selected credential source;
- an explicitly configured corporate Bedrock proxy or custom endpoint.

A custom endpoint is trusted only after explicit configuration. It must be
displayed during doctor validation and before the first inference request. The
extension must not silently treat an arbitrary custom URL as Amazon Bedrock.

AWS authentication endpoints receive authentication protocol data, not project
code. Only the Bedrock inference destination may receive project context.

Do not silently fall back to unrelated credential or metadata endpoints.
Document and test the exact AWS credential-chain behavior retained by the
extension.

### Public research traffic

Allow HTTP GET and HEAD requests for:

- search-engine queries;
- public documentation and web pages;
- public images required by an explicitly requested research result.

Research requests must:

- have no request body;
- carry no workspace-derived headers;
- carry no cookies, authorization, proxy-authorization, or referrer;
- use a generic product user agent without user, company, repository, or
  workspace identifiers;
- limit redirects and revalidate every redirect destination;
- block credentials embedded in URLs;
- block localhost, link-local, private-network, file, data, JavaScript, and
  cloud-metadata destinations;
- apply DNS-rebinding and SSRF protections;
- enforce response size, content-type, redirect, and timeout limits;
- display the destination and sanitized query when approval is required.

Do not use POST-based search, form submission, file upload, clipboard upload,
authenticated browsing, or arbitrary JavaScript submission in the
corporate-safe default.

## Trust Boundaries for Retained Tools

### Browser and web fetching

Retain public online research, but split browser capability into:

1. **Research navigation**: sanitized GET/HEAD navigation and page reading;
2. **External interaction**: forms, POST requests, uploads, authentication,
   clipboard insertion, downloads, and state-changing browser actions.

Only research navigation is enabled by default. External interaction is
disabled in the corporate-safe build unless a future scope explicitly defines
and accepts its data boundary.

The agent must not construct a URL or search query from file contents, code
excerpts, tool output, terminal output, conversation history, or model text
that may echo sensitive workspace data.

### MCP

- Remote MCP over HTTP, SSE, WebSocket, and OAuth is disabled by default.
- Remote MCP must not receive workspace code in the corporate-safe build.
- A local stdio MCP process is not automatically safe: it can create its own
  network connections outside the extension's network layer.
- Retain local MCP only with a clear warning that the executable is trusted
  local code and with explicit enablement.
- For the strongest corporate mode, allow only organization-approved local MCP
  executables run inside an externally enforced no-network sandbox.
- Remove hosted MCP discovery, remote installation, and automatic package
  download paths.

### Skills and plugins

- Declarative local skills may remain.
- Treat executable plugins as local code execution, not as harmless
  configuration.
- Do not automatically download, update, or execute remote plugin content.
- Require explicit enablement and identify the executable entrypoint.
- An executable plugin cannot be guaranteed network-isolated by the extension
  alone. The corporate-safe mode must disable it unless an external sandbox or
  organization policy supplies that guarantee.

### Terminal

Terminal commands remain optional and require approval.

Commands can exfiltrate data through `curl`, PowerShell web cmdlets, Git pushes,
cloud CLIs, package managers, custom executables, DNS, or other channels.
Cross-platform command-text inspection cannot provide a complete guarantee.

Therefore:

- terminal support is disabled by default in the strongest corporate-safe
  profile;
- when enabled, every command requires explicit approval;
- obvious network-capable commands receive a distinct external-network warning;
- no command is described as safe merely because a blacklist did not match it;
- an absolute no-exfiltration deployment must enforce network restrictions
  outside VS Code at the operating-system, container, or corporate-proxy layer.

## Known Release-Blocking Findings

The audit starts with these known paths:

1. `apps/vscode/src/services/lg-cns-integration/webhook-hooks.ts` creates hooks
   that can post workspace roots, task metadata, tool names, and tool parameters
   to an arbitrary webhook.
2. `apps/vscode/src/services/uri/SharedUriHandler.ts` can configure and install
   those webhook hooks from a URI flow.
3. `apps/vscode/src/integrations/misc/link-preview.ts` performs automatic GET
   and HEAD requests for link previews and remote image detection.
4. `apps/vscode/src/core/controller/mcp/addRemoteMcpServer.ts` retains remote MCP
   configuration.
5. `sdk/packages/core/src/extensions/tools/executors/web-fetch.ts` permits
   arbitrary HTTP/HTTPS GET requests without a complete corporate egress
   policy.
6. `sdk/packages/llms/scripts/models/generate-models-dev.ts` accesses
   `models.dev`. It is development-only but must not be reachable from the
   installed extension or required by a release build.

Remove the webhook integration and its URI/configuration/test paths entirely.
Do not merely hide its UI. Classify and remediate every other path under the
policy in this handoff.

## Stage 1: Establish a Reproducible Release Candidate

### Clean source state

1. Confirm Phase 12 is committed.
2. Record commit SHA, Bun version, Node version, operating system, architecture,
   and VS Code version.
3. Confirm no unrelated or untracked files can enter the build.
4. Run a secret scan before installing or packaging.
5. Install from the committed lockfile without updating dependency versions.

Required commands:

```powershell
# Repository root
bun install --frozen-lockfile
bun run build:sdk

# apps/vscode
bun run check-types
bun esbuild.mjs --production
bun run package
```

If the repository's package script does not emit a VSIX, use the retained local
VSIX packaging command and record it in the results. Do not publish or push.

### Artifact inspection

Extract the VSIX and verify:

- manifest identity is `fffalexgo.bedrock-coder`;
- no `.env`, credentials, certificates, logs, caches, history, checkpoints, or
  local configuration are included;
- no tests, fixtures, recordings, source maps, browser downloads, Storybook,
  development scripts, or nested package caches are included;
- no obsolete Cline branding or executable compatibility paths are included;
- required license and attribution files are included;
- the compiled extension contains only expected URLs and destination patterns.

Record:

- VSIX path;
- byte size;
- SHA-256;
- archive entry list;
- source commit SHA.

## Stage 2: Isolated Installation and Functional Qualification

Install the release candidate into dedicated VS Code user-data and extensions
directories. Do not test it first in the developer's normal VS Code profile.

Verify without credentials:

- installation succeeds;
- extension activation succeeds;
- sidebar, icon, commands, and settings load;
- doctor explains missing credentials without crashing;
- no automatic external traffic occurs;
- local logs contain no secrets or source content;
- disable/uninstall/reinstall works.

Verify with temporary credentials supplied only to the isolated VS Code
process:

- environment credentials;
- profile/SSO where available;
- region, endpoint, and CA bundle;
- doctor checks and diagnostic detail;
- model and inference-profile discovery;
- model selection;
- streaming chat, progress, cancellation, and usage;
- Plan and Act modes;
- file read and code search;
- multi-file edit, reviewable diff, rejection, and approval;
- optional terminal command approval;
- browser research using a sanitized query;
- local MCP under the documented trust boundary;
- teams, worktrees, and Kanban;
- Git commit-message generation;
- conversation history;
- checkpoint compare, restore, and resume after restart;
- clean failure and recovery after TLS, authorization, model, network, and
  cancellation errors.

Never place credentials in `.env`, fixtures, screenshots, logs, commands,
history, or the results document.

## Stage 3: Complete Static Egress Inventory

Scan executable source, scripts used during packaging, generated source,
dependencies, and the compiled VSIX for all outbound or execution sinks:

```text
fetch / Axios
http / https
net / tls / dns
WebSocket / EventSource / SSE
AWS SDK clients
browser navigation and request interception
remote images, previews, and embeds
MCP transports and OAuth
webhooks
child_process / spawn / exec
VS Code terminals and tasks
shell scripts and generated hooks
package installation and downloads
URI/deep-link handlers
update and release checks
telemetry and analytics SDKs
dynamic imports and executable plugins
```

For every reachable sink, record:

- source file and owner;
- destination derivation;
- HTTP method or transport;
- request headers and body;
- possible sensitive inputs;
- whether redirects are followed;
- activation condition;
- user approval behavior;
- retained justification or removal decision.

Create a machine-readable checked-in egress registry. A focused security check
must fail when executable production code introduces an unregistered network
or process-execution sink.

Searches alone are not proof. Review wrappers, aliases, dynamic imports,
generated code, dependencies, and compiled output.

## Stage 4: Sensitive-Data Provenance and Central Egress Enforcement

### Provenance classes

Introduce explicit information classes:

```text
PUBLIC
WORKSPACE_SENSITIVE
SECRET
UNTRUSTED_WEB
```

At minimum, classify as `WORKSPACE_SENSITIVE`:

- file reads and code search results;
- file paths and repository metadata;
- diffs and diagnostics;
- terminal and tool output;
- prompts, conversation history, model responses, and checkpoints.

Classify credentials, tokens, authorization headers, private keys, and secret
storage as `SECRET`.

Web content is `UNTRUSTED_WEB`. It may enter Bedrock context, but instructions
inside web content must never relax the egress policy.

### Sink rules

- Bedrock inference may receive `PUBLIC`, `WORKSPACE_SENSITIVE`, and selected
  `UNTRUSTED_WEB` context, but never raw credentials.
- AWS authentication endpoints may receive only required authentication
  protocol data.
- Public research sinks may receive only sanitized `PUBLIC` URLs and queries.
- Logs may receive redacted operational metadata only.
- All other outbound sinks reject sensitive data.

Do not rely solely on detecting whether a string “looks like code.” Track the
origin of values through tool and session boundaries where practical. Apply a
second secret/code/path detector at the outbound boundary as defense in depth.

### Central guard

Route extension-controlled network requests through a fail-closed policy
service that:

- classifies the destination and operation;
- validates the data class permitted for that sink;
- strips prohibited headers and cookies;
- limits method, redirects, size, content type, and timeout;
- records destination, byte counts, operation type, and allow/deny decision
  without recording sensitive content;
- blocks requests it cannot classify;
- returns a clear diagnostic instead of silently retrying elsewhere.

Direct production use of network primitives outside approved transports must
fail the focused security check.

## Stage 5: Safe Online Research

Create a dedicated research API instead of allowing general-purpose fetch.

### Search

- Accept a short natural-language query.
- Reject secrets, code blocks, long encoded strings, file paths, tool output,
  and workspace-derived text.
- Cap query length.
- Display the final query and destination when approval policy requires it.
- Use GET only and encode the query in a predictable field.
- Never attach conversation history or hidden context.

### Page retrieval

- Accept only HTTP/HTTPS public URLs.
- Apply SSRF, DNS-rebinding, redirect, port, and private-address protections.
- Send no body, cookies, authorization, referrer, workspace headers, or browser
  profile state.
- Use a generic user agent.
- Treat downloaded content as untrusted and size-bounded.
- Do not execute page scripts for simple retrieval.

### Browser automation

Use an isolated ephemeral browser profile with no corporate cookies, saved
passwords, extensions, history, downloads, or authenticated sessions.

Block by default:

- form submission;
- POST/PUT/PATCH/DELETE;
- file chooser and upload;
- clipboard insertion;
- drag-and-drop upload;
- authentication;
- downloads;
- WebSocket and background service-worker traffic;
- model-generated JavaScript that transmits page or workspace data.

If a requested workflow requires one of these actions, fail with a clear
corporate-policy message rather than weakening the guard.

## Stage 6: Secret, Storage, and Logging Audit

Scan the current tree and complete Git history using Gitleaks or an equivalent
secret scanner.

Check:

- AWS keys and session tokens;
- SSO/OAuth tokens;
- webhook and API tokens;
- cookies and authorization headers;
- certificates and private keys;
- secrets in fixtures, recordings, logs, screenshots, documentation, generated
  files, commits, and deleted history.

Audit runtime handling:

- credentials are resolved in memory and never persisted;
- SecretStorage is used only for data that is valid to persist;
- diagnostics redact credentials, source, prompts, paths, and request bodies;
- exceptions do not serialize AWS request objects containing sensitive data;
- history/checkpoints remain local and use the intended storage root;
- workspace files do not enter telemetry, logs, crash reports, or issue URLs;
- local files have appropriate permissions;
- uninstall and cleanup do not delete unrelated user or official Cline data.

Any real secret in Git history is a release blocker and must be revoked in
addition to repository remediation.

## Stage 7: Code and Supply-Chain Security

Perform focused static analysis and manual review for:

- command and argument injection;
- path traversal, symlink escape, and unsafe checkpoint restore;
- arbitrary file overwrite or deletion;
- SSRF and DNS rebinding;
- XSS, unsafe Markdown/HTML/SVG, and webview message validation;
- unsafe deserialization and prototype pollution;
- deep-link/URI abuse;
- extension-host to webview trust violations;
- approval bypasses, including child-agent inheritance;
- plugin/MCP sandbox escape;
- unbounded resource consumption and decompression bombs;
- credential and CA-bundle handling.

Supply-chain work:

- scan direct and transitive dependencies for known vulnerabilities;
- review all lifecycle/postinstall scripts;
- confirm lockfile integrity;
- remove unreachable high-risk dependencies;
- generate an SBOM for the final artifact;
- record licenses and required notices;
- scan the extracted VSIX, not only the source tree.

Critical and high findings block release. Lower findings require a written
impact assessment and explicit acceptance.

## Stage 8: Dynamic Egress Verification

Run the installed extension in an isolated environment with connection capture
and deny-by-default network controls.

Exercise:

- cold activation;
- startup doctor;
- credential failure and success;
- model discovery and selection;
- chat and streaming;
- file reads, searches, edits, and diffs;
- terminal approval and rejection;
- web research;
- MCP/plugin enablement and rejection;
- teams and child agents;
- history and checkpoint restoration;
- cancellation, timeout, TLS, proxy, and authorization errors;
- restart and shutdown.

Required observations:

- cold activation has no unexplained external traffic;
- project context goes only to the configured Bedrock inference destination;
- AWS authentication and discovery traffic contains no project context;
- public research traffic contains only the reviewed URL/query and minimal
  protocol headers;
- link preview, remote image, webhook, telemetry, hosted catalog, and update
  traffic is absent;
- denied operations generate a visible local diagnostic;
- no fallback destination is attempted after denial.

Use a controlled fake workspace containing unique canary strings in:

- source code;
- filenames and paths;
- prompts;
- terminal output;
- tool output;
- fake credentials.

Monitor outbound URLs, headers, bodies, DNS requests, logs, history, and VSIX
state for those canaries. Only the controlled Bedrock test destination may
observe workspace canaries; no destination may observe fake credential
canaries.

## Stage 9: Rebuild the Final Artifact

Security changes invalidate the first release candidate.

After all blockers are fixed:

1. start from the final committed source tree;
2. repeat the clean frozen install;
3. rerun required builds and focused security checks;
4. package a new VSIX;
5. inspect every archive entry;
6. repeat isolated install and critical functional checks;
7. repeat secret, vulnerability, compiled-URL, and dynamic egress scans;
8. calculate the final SHA-256;
9. verify the installed extension is byte-for-byte the final artifact.

Do not push or publish in Phase 13.

## Second-Computer QA Handoff

Provide:

```text
bedrock-coder-0.1.0.vsix
bedrock-coder-0.1.0.vsix.sha256
phase13-results.md
SBOM
egress inventory
security findings summary
```

The QA instructions must be concise and include:

1. verify SHA-256 before installation;
2. install using `Extensions -> ... -> Install from VSIX...`;
3. restart VS Code;
4. provide AWS credentials only to the launched VS Code process;
5. run doctor and select a model;
6. perform one streaming chat and cancellation;
7. review and apply a multi-file edit;
8. reject and approve one safe terminal command if terminal support is enabled;
9. perform one sanitized public web search;
10. restart and resume history/checkpoint state;
11. export redacted diagnostics if anything fails.

Record the other computer's OS, architecture, VS Code version, AWS credential
source, and result. Never include credentials in the report.

## Minimal Automated Coverage

Do not create a broad new test suite. Add focused release-blocking checks for:

- package identity and archive contents;
- known webhook/telemetry/hosted-service absence;
- registered network/process callsites;
- Bedrock-only sensitive-data sink policy;
- sanitized GET/HEAD research requests;
- redirect and SSRF blocking;
- secret/header stripping;
- prompt-injection attempts to place canary code in a search query;
- remote MCP and external browser interaction disabled by default;
- diagnostic redaction;
- approval policy inheritance;
- installation and activation.

Run existing tests only where Phase 13 changes the relevant component.

## Done When

- the exact final VSIX installs and activates in an isolated profile;
- required retained functionality passes the acceptance matrix;
- the known webhook integration and all equivalent uncontrolled egress paths
  are removed;
- only Bedrock inference may receive project code or workspace-sensitive data;
- AWS authentication/control-plane traffic receives no project context;
- public online research works using sanitized receive-oriented GET/HEAD
  traffic;
- web research cannot place workspace content, code, secrets, paths, prompts,
  or tool output in URLs, headers, or bodies;
- prompt injection from web content cannot weaken the egress policy;
- remote MCP, executable plugins, browser interaction, and terminal networking
  follow the documented corporate-safe boundaries;
- cold activation produces no unexplained external traffic;
- current tree, Git history, logs, and VSIX pass secret scanning;
- source and VSIX pass vulnerability, static-security, and egress reviews;
- SBOM, egress registry, scan results, install report, final size, and SHA-256
  are recorded;
- the final artifact is ready for controlled QA on the other computer.

## Commit

Suggested message:

```text
security: qualify release and enforce Bedrock-only code egress
```

## Completion Handoff

Create `plan/phase13-results.md` containing:

- source and final commit SHAs;
- build environment;
- initial and final VSIX paths, sizes, and SHA-256 values;
- installation and functional results;
- removed outbound paths;
- final destination/egress inventory;
- central policy and provenance implementation;
- online-research safeguards;
- secret scan scope and result;
- dependency/SBOM/vulnerability results;
- static and dynamic security findings;
- canary-test observations;
- remaining risks and their disposition;
- exact second-computer QA instructions.
