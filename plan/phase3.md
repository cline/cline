# Phase 3 Handoff: Bedrock-Only Runtime and AWS Connection

## Goal

Replace Cline's multi-provider inference system with one small AWS Bedrock
runtime. Remove non-Bedrock provider code, UI, configuration, tests, and
dependencies. Support only:

- credentials inherited from the VS Code extension environment;
- an optional named AWS profile, including an authenticated SSO profile;
- AWS region;
- optional custom Bedrock endpoint;
- optional custom CA bundle.

This phase should delete code instead of preserving generic provider
extensibility that the finalized product does not need.

Repository: `C:\Coding\cline_aws`

Read `plan/scope.md` and the applicable `AGENTS.md` files before editing.
Preserve unrelated user changes and conversation history.

## Final Runtime Shape

Use a single connection type similar to:

```ts
type BedrockConnection = {
  region: string
  profile?: string
  endpoint?: string
  caBundlePath?: string
}
```

Keep the selected model identifier outside the connection object. The runtime
may retain `"bedrock"` as a literal model-provider field where existing history
or agent APIs require it, but users must not be able to select another
provider.

Do not retain fields for API keys, manually entered AWS access keys, secret
keys, session tokens, base URLs for other providers, or generic custom LLM
providers.

## Authentication Rules

Use the AWS SDK credential-provider chain:

- If `profile` is empty, use the default chain. This includes
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`,
  container/instance credentials, and the default shared AWS configuration.
- If `profile` is set, resolve that profile with the AWS SDK. SSO works from
  the SDK's normal cached SSO session after the user has authenticated
  externally.
- `AWS_PROFILE` may be honored by the default chain when no profile is selected
  in the extension.

Credentials are input to the extension process, not application settings.
Never save or copy credentials into:

- VS Code global or workspace state;
- `providers.json`;
- `.env` files;
- logs;
- checkpoints;
- history;
- model prompts or tool output.

Remove Bedrock bearer/API-key authentication and the UI for manually entering
AWS access keys, secret keys, and session tokens.

## AWS Network Rules

- Require a region and provide a simple default such as `us-east-1`.
- Accept an optional HTTPS Bedrock endpoint.
- Accept an optional CA-bundle file path.
- Resolve a relative CA path from the first workspace root. If there is no
  workspace, require an absolute path.
- Validate that the CA file exists, is a file, and contains readable PEM data
  before creating the client.
- Use one AWS transport helper so the same CA configuration applies to
  credential-provider network calls, Bedrock control-plane calls, and Bedrock
  runtime streaming.
- Do not disable TLS verification.
- Do not mutate process-wide TLS settings.

Return short, sanitized errors for:

- missing or unreadable CA bundle;
- invalid TLS certificate;
- DNS or proxy failure;
- invalid endpoint;
- missing or expired credentials;
- access denied;
- invalid region;
- Bedrock validation error.

Detailed doctor behavior and model discovery belong to the next phase, but
Phase 3 errors must include the failure category and original AWS request ID
when available.

## Remove from the LLM SDK

Under `sdk/packages/llms`, remove:

- every non-Bedrock vendor implementation and its tests;
- OpenAI-compatible and local-provider paths;
- provider live/VCR fixtures for removed providers;
- generated multi-provider manifests and catalog generation that Bedrock no
  longer uses;
- provider-specific routing, aliases, billing rules, and reasoning codecs that
  Bedrock does not use;
- optional CLI-provider integrations;
- non-Bedrock dependencies and peer dependencies.

Keep only the pieces required for:

- the Bedrock factory;
- message and tool-call conversion;
- streaming and cancellation;
- usage reporting;
- Bedrock-supported reasoning options;
- shared model information needed by the agent.

Prefer a direct `createBedrockClient()` or equivalent entry point over a
factory registry containing one item. Replace provider unions with the literal
`"bedrock"` or remove the provider field where safe.

It is acceptable to retain a small static Bedrock model metadata file
temporarily. Dynamic model and inference-profile discovery will replace it in
the next phase.

## Remove from the VS Code Extension

Remove:

- provider dropdowns and provider-switching logic;
- non-Bedrock provider settings components and model pickers;
- per-provider refresh handlers and subscriptions;
- OpenAI Codex OAuth integration and other provider authentication handlers;
- non-Bedrock provider fixtures and tests;
- favorites, recommendations, or banners that exist only for the general
  provider catalog;
- non-Bedrock provider fields from protobuf messages, state keys, migrations,
  and webview messages when they are no longer referenced.

Replace the existing provider settings surface with one small Bedrock
connection form containing:

1. region;
2. optional AWS profile;
3. optional endpoint;
4. optional CA-bundle path.

Do not show an authentication-method selector. An empty profile means the
default AWS credential chain.

Keep model selection functional using Bedrock-only metadata until dynamic
discovery is implemented. Plan and Act may keep separate selected model IDs if
the existing workflow requires them, but both must use the same Bedrock
connection.

## State and Migration

Create one small migration:

- preserve existing Bedrock region, profile, endpoint, CA path, and selected
  Bedrock model when safe;
- discard stored credentials and non-Bedrock provider configuration;
- if the previous provider was not Bedrock, reset only inference configuration
  to the Bedrock defaults;
- preserve conversations, checkpoints, task history, worktrees, and user
  content.

After the migration, delete the broad legacy provider-migration machinery if
it has no remaining use. Do not maintain compatibility for switching back to a
removed provider.

## Implementation Order

1. Check the branch and working tree.
2. Introduce the minimal `BedrockConnection` type and AWS transport helper.
3. Convert the Bedrock factory to environment/profile credentials only.
4. Replace runtime provider selection with the direct Bedrock path.
5. Simplify storage and add the one-time migration.
6. Replace the settings UI with the four Bedrock connection fields.
7. Delete non-Bedrock provider UI, controller handlers, SDK modules, fixtures,
   and tests.
8. Remove unused dependencies and regenerate `bun.lock` with `bun install`.
9. Search for reachable non-Bedrock provider references.
10. Run the required verification and commit Phase 3 independently.

Do not merely hide provider choices in the UI. Their runtime registrations,
configuration fields, imports, and packaged dependencies must be removed.

## Focused Searches

Use searches to find the remaining provider surface, then review results rather
than blindly deleting every textual match:

```powershell
rg -n "anthropic|openai|openrouter|gemini|vertex|ollama|mistral|qwen|groq|cline-pass|vscode-lm|litellm|requesty|huggingface" apps/vscode sdk/packages
rg -n "accessKey|secretKey|sessionToken|api-key|apikey|AWS_BEARER_TOKEN_BEDROCK" apps/vscode sdk/packages
```

Model names in historical fixtures or Bedrock model metadata may contain words
such as `anthropic`; that is not itself another provider. What must disappear
is non-Bedrock routing, authentication, configuration, and invocation.

## Minimal Verification

Do not port or run the large multi-provider test suites. Delete tests whose
subject was removed.

Keep only focused coverage for:

1. default-chain environment credentials, including a session token;
2. named profile/SSO selection without persisting credentials;
3. CA-bundle path validation and custom TLS transport;
4. the runtime exposing only Bedrock.

Then run:

```powershell
# Repository root
bun install
bun run build:sdk

# apps/vscode
bun run check-types
bun esbuild.mjs
bun run package
```

Manual smoke test:

1. Install the generated VSIX.
2. Confirm the settings show only the four Bedrock connection fields.
3. Start one chat with temporary environment credentials or a working profile.
4. Confirm the response streams and can be cancelled.
5. Confirm no credentials appear in settings, logs, history, or checkpoints.

If no live AWS connection is available, record that the live streaming check
was not run; do not add a large mocked integration suite to compensate.

## Done When

- Bedrock is the only reachable inference provider.
- The packaged extension has no provider selector.
- Only environment credentials and AWS profile/SSO are supported.
- No AWS secrets are persisted.
- Region, endpoint, and CA bundle work through one AWS transport path.
- Non-Bedrock provider code, tests, settings, fixtures, and dependencies are
  removed.
- Existing conversations and checkpoints remain intact.
- SDK build, VS Code typecheck, bundle, package, and the small smoke test pass.

## Commit

Suggested message:

```text
refactor: reduce inference runtime to AWS Bedrock
```

The completion handoff should report:

- commit SHA;
- major deleted provider directories and dependencies;
- the final connection/state shape;
- migration behavior;
- required command results;
- live streaming result, or why it was not run;
- any remaining non-Bedrock reference and why it is harmless.
