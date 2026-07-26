# Phase 8 Handoff: Bedrock Discovery, Startup Selection, and Automatic Doctor

## Goal

Add one Bedrock-native startup flow on top of the clean Phase 7 core:

1. validate the AWS connection;
2. discover relevant foundation models and inference profiles dynamically;
3. let the user select an invocable destination;
4. probe that exact destination through the production streaming runtime;
5. enter chat only after the probe succeeds.

The implementation must remain Bedrock-only and must not reintroduce generic
provider registries, hosted services, or persisted credentials.

Repository: `C:\Coding\cline_aws`

Prerequisite: Phase 7 is committed and tagged. Read `plan/scope.md`, the Phase
3 AWS connection contract, and the applicable `AGENTS.md` files before editing.

## Product Flow

On extension activation:

```text
Load connection settings
  -> resolve AWS credentials
  -> validate identity and TLS
  -> connect to Bedrock control plane
  -> discover models and profiles
  -> select or confirm a destination
  -> probe the selected destination
  -> enter ready chat
```

If a valid destination was saved previously, rediscover and confirm it before
probing. If it is no longer returned or no longer invocable, return to
selection with a clear explanation.

The user must always be able to:

- cancel;
- retry the failed stage;
- edit AWS connection settings;
- refresh discovery;
- choose another destination;
- copy sanitized diagnostics;
- open the local diagnostic log.

## Architecture

Keep the implementation small and Bedrock-specific:

```text
Phase 3 AWS connection/transport
  -> BedrockDiscoveryService
  -> BedrockStartupDoctor
  -> BedrockStartupController
  -> VS Code startup/selection view
  -> existing Bedrock streaming runtime
```

Ownership:

- `sdk/packages/llms`: Bedrock runtime invocation, message/tool conversion,
  streaming, cancellation, and usage normalization.
- VS Code extension host: AWS control-plane discovery, startup orchestration,
  local settings, progress, diagnostics, and webview RPC.
- Shared contracts: only the small serializable target, progress, and error
  types needed across the extension/webview boundary.

Do not create:

- a generic provider-discovery framework;
- a provider catalog service;
- remote model recommendations;
- a hosted control plane;
- a second AWS credential or TLS implementation.

## Connection Contract

Reuse the Phase 3 connection:

```ts
type BedrockConnection = {
  region: string
  profile?: string
  endpoint?: string
  caBundlePath?: string
  controlPlaneEndpoint?: string
}
```

`endpoint` remains the Bedrock Runtime override. Discovery uses the standard
regional Bedrock control-plane endpoint unless `controlPlaneEndpoint` is
explicitly configured.

Do not guess a control-plane URL from an arbitrary runtime/VPC endpoint. AWS
uses separate Bedrock control-plane and runtime services. Keep
`controlPlaneEndpoint` under an advanced custom-endpoint section and leave it
empty for normal regional AWS endpoints.

The CA bundle applies to:

- AWS credential-provider network calls;
- STS identity validation;
- Bedrock control-plane discovery;
- Bedrock Runtime streaming.

Do not disable TLS validation or mutate process-wide TLS settings.

## AWS Clients and Permissions

Use AWS SDK for JavaScript v3 clients with the existing credential provider and
transport:

- `STSClient` with `GetCallerIdentityCommand`;
- `BedrockClient` with `ListFoundationModelsCommand`;
- `BedrockClient` with paginated `ListInferenceProfilesCommand`;
- `GetInferenceProfileCommand` only when summary data cannot identify the base
  model;
- the existing Bedrock Runtime path for the destination probe.

Document the required IAM actions:

```text
bedrock:ListFoundationModels
bedrock:ListInferenceProfiles
bedrock:GetInferenceProfile       # when detail lookup is required
bedrock:InvokeModel
bedrock:InvokeModelWithResponseStream
```

Identity validation uses STS only to distinguish invalid/expired credentials
from Bedrock authorization failures. Do not store the returned account or ARN
in history, checkpoints, or model context. A masked account identifier may be
shown in diagnostics during the current session.

## Discovery Target Contract

Use one serializable target type:

```ts
type BedrockTarget = {
  kind: "foundation-model" | "inference-profile"
  invocationId: string
  arn?: string
  displayName: string
  providerName?: string
  baseModelId?: string
  profileType?: "SYSTEM_DEFINED" | "APPLICATION"
  inputModalities: string[]
  outputModalities: string[]
  streaming: boolean
  lifecycle?: string
}
```

`invocationId` is the exact value passed to the runtime. Never reconstruct it
from the display name.

For inference profiles, prefer the profile ID returned by AWS when supported
by the runtime; retain the ARN as returned and use it when the target or
endpoint requires an ARN. Application profiles must be selectable.

## Foundation-Model Discovery

Call `ListFoundationModels` and retain models that:

- are active rather than legacy/deprecated;
- accept text input;
- produce text output;
- support response streaming;
- support an invocation type usable by the current Bedrock runtime.

Exclude:

- image-only models such as Stable Image;
- embedding and reranking models;
- speech/audio-only models;
- models without text output;
- non-streaming destinations;
- legacy models unless the user explicitly enables an advanced
  "show legacy" option later.

Do not impose an arbitrary top-49 or other UI limit. `ListFoundationModels`
does not use the inference-profile pagination contract; consume every model
summary returned by the operation.

## Inference-Profile Discovery

Call `ListInferenceProfiles` with the maximum reasonable page size and continue
until `nextToken` is absent. Discover both:

- `SYSTEM_DEFINED` profiles;
- `APPLICATION` profiles.

For each profile:

1. retain the exact ID and ARN;
2. inspect its model ARNs;
3. join those ARNs to discovered foundation-model metadata;
4. call `GetInferenceProfile` only when the summary is insufficient;
5. apply the same text-output and streaming compatibility rules;
6. exclude image, embedding, reranking, speech, and unrelated profiles.

Do not filter profiles by name alone. A name such as "US Stable Image" should
be excluded because its underlying model is not a streaming text destination,
not merely because it contains a particular word.

Deduplicate by `kind + invocationId`, not display name.

## Agent Compatibility

Discovery metadata proves modality and streaming support but does not fully
prove that the production agent request shape is accepted.

After selection, run a minimal probe through the same runtime adapter used by
chat:

- use the selected `invocationId` unchanged;
- include a tiny text prompt;
- include one harmless tool definition so the request validates the coder's
  tool-capable request shape;
- request the smallest practical output;
- confirm at least one stream event or a valid completion;
- capture normalized usage when returned;
- cancel through the same `AbortSignal` path as chat.

The probe may incur a very small Bedrock charge. State this in the UI. Do not
probe every discovered target automatically.

A target that fails the probe remains visible with its failure status so the
user can inspect diagnostics or choose another model. Do not silently remove
it after selection.

## Session Cache and Persistence

Cache discovery results in memory for the current extension session, keyed by:

- region;
- runtime endpoint;
- control-plane endpoint;
- profile name or default-chain marker;
- CA-bundle path and file modification time.

Do not include credentials or tokens in cache keys.

Provide explicit refresh. Cancel and discard an older request when connection
settings change.

Persist only:

- selected target kind;
- selected invocation ID;
- target ARN when needed;
- base-model ID/capability metadata needed to resume;
- region and non-secret connection settings.

Never persist credentials, STS identity data, raw AWS responses, or
authorization headers.

## Startup State Machine

Use one explicit state machine:

```text
idle
resolvingCredentials
validatingIdentity
checkingBedrock
discoveringModels
discoveringProfiles
awaitingSelection
probingSelection
ready
cancelled
failed
```

Every state publishes:

- short user-facing label;
- start time;
- cancellability;
- sanitized diagnostic stage.

Only `ready` enables prompt submission. Cancellation returns to a usable
configuration or selection state and must not close the extension chat
silently.

## Error Contract

Return a structured sanitized error:

```ts
type BedrockDoctorError = {
  stage: string
  category:
    | "configuration"
    | "credentials"
    | "tls"
    | "dns"
    | "proxy"
    | "endpoint"
    | "authorization"
    | "throttling"
    | "model-validation"
    | "streaming"
    | "cancelled"
    | "unknown"
  service?: "sts" | "bedrock" | "bedrock-runtime"
  operation?: string
  awsCode?: string
  httpStatus?: number
  requestId?: string
  message: string
  suggestion?: string
}
```

Preserve AWS error code, HTTP status, and request ID. Redact:

- access keys, secret keys, and session tokens;
- authorization and security-token headers;
- profile cache contents;
- full STS identity;
- prompt content beyond the fixed probe description;
- sensitive endpoint query parameters.

Avoid generic messages such as "agent run failed safely" or "destination probe
failed" without the structured fields.

## User Interface

Use one Bedrock startup panel:

1. connection summary;
2. live doctor stage and elapsed time;
3. model/profile selector;
4. probe result;
5. retry, refresh, cancel, edit settings, copy diagnostics, and open-log
   actions.

Group choices as:

```text
Foundation models
Inference profiles
```

Each row should show:

- display name;
- exact invocation ID;
- profile badge when applicable;
- provider/base model when known;
- streaming/compatibility status;
- probe failure indicator when applicable.

Do not display unrelated provider choices, image models, marketing cards,
pricing, favorites, or hosted recommendations.

## Implementation Order

1. Confirm the Phase 7 tag and clean working tree.
2. Add the small discovery/doctor shared contracts.
3. Add `@aws-sdk/client-bedrock` and `@aws-sdk/client-sts` only if not already
   retained.
4. Reuse the Phase 3 credential and TLS transport for STS and control-plane
   clients.
5. Implement foundation-model discovery and filtering.
6. Implement fully paginated inference-profile discovery and metadata joining.
7. Add in-memory caching, refresh, cancellation, and stale-request protection.
8. Implement identity, connectivity, and selected-target probes.
9. Implement the startup state machine and structured error mapping.
10. Add the Bedrock startup/selection UI and webview RPC.
11. Replace temporary static startup selection while retaining only the minimum
    fallback metadata needed by the runtime.
12. Verify resume behavior when a saved target disappears or credentials
    expire.
13. Remove dead temporary model-list code and dependencies.
14. Run focused tests, live smoke tests, package inspection, and commit Phase 8
    independently.

## Minimal Automated Coverage

Keep tests focused:

1. one table-driven discovery test covering filtering, profile joining,
   deduplication, and complete `nextToken` pagination;
2. one startup-state test covering success, cancellation, and one categorized
   failure;
3. one runtime-boundary test proving a selected profile ID/ARN reaches the
   Bedrock invocation unchanged;
4. one redaction test for credentials, headers, identity, and request
   diagnostics.

Do not recreate a large provider-model fixture catalog or test every AWS model.

## Required Commands

```powershell
# Repository root
bun install
bun run build:sdk

# apps/vscode
bun run check-types
bun esbuild.mjs
bun run package
```

## Live Acceptance

Run with temporary environment credentials and, when available, one named
profile/SSO session:

1. start the extension with region, optional endpoint, and CA bundle;
2. observe credential, identity, connectivity, and discovery progress;
3. confirm all pages of relevant models/profiles appear;
4. confirm image/embedding profiles do not appear;
5. select a foundation model and complete the probe;
6. select an inference profile and complete the probe;
7. enter chat and stream one real response;
8. cancel one in-flight request;
9. introduce an invalid CA path and confirm a specific configuration error;
10. introduce expired/invalid credentials and confirm a credential error;
11. choose a non-invocable target and confirm AWS validation details and
    request ID are visible;
12. restart VS Code and confirm the saved target is rediscovered and rechecked.

Do not require testing every displayed model.

## Done When

- startup validates the AWS connection automatically;
- discovery returns all relevant foundation models and every page of system and
  application inference profiles;
- image, embedding, reranking, speech, and non-streaming targets are excluded;
- every selector entry uses the exact AWS invocation ID or ARN;
- foundation models and profiles can both be selected and probed;
- prompt submission is enabled only in the `ready` state;
- progress, elapsed time, cancellation, retry, and refresh are visible;
- errors expose actionable sanitized AWS diagnostics;
- credentials and identity data are never persisted;
- a saved destination is rediscovered and revalidated after restart;
- required commands, focused tests, live acceptance, and VSIX packaging pass.

## Commit

Suggested message:

```text
feat: add Bedrock discovery and startup doctor
```

## Completion Handoff

Report:

- commit SHA;
- added AWS dependencies;
- discovery/filtering rules;
- pagination and cache behavior;
- startup-state implementation location;
- live foundation-model and inference-profile results;
- probe and cancellation results;
- error/redaction results;
- required command and VSIX path;
- any unsupported Bedrock target and the exact AWS reason.

## AWS References

- [ListFoundationModels](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListFoundationModels.html)
- [ListInferenceProfiles](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListInferenceProfiles.html)
- [ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html)
- [Using inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-use.html)
