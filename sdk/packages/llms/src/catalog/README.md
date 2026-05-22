# Model Catalog Semantics

The generated catalog is the SDK's normalized copy of provider and model
metadata. Most built-in catalog data comes from [models.dev](https://models.dev)
through `catalog-live.ts` and is written to `catalog.generated.ts` by the model
generation scripts.

This file documents the intended meaning of the token-limit fields and the
boundary between catalog metadata and runtime request policy.

## Source Fields

`models.dev` exposes model limits under `limit`:

```text
limit.context  maximum context budget reported for the model
limit.input    optional stricter prompt/input-token budget
limit.output   maximum output tokens reported for generation
```

`limit.input` is not present for every model. When it is present, it should be
treated as the best available prompt/input ceiling. When it is absent, the
catalog falls back to `limit.context` for the prompt/input ceiling.

## Cline Fields

The catalog maps those source fields into `ModelInfo`:

```text
contextWindow   provider-reported context budget
maxInputTokens  prompt/input-token budget used by compaction and diagnostics
maxTokens       provider-reported output-token budget
```

These fields are not additive guarantees. In particular, this is valid catalog
metadata:

```text
contextWindow:  200000
maxInputTokens: 200000
maxTokens:      128000
```

That means:

```text
the prompt may be allowed to approach 200000 tokens
the model may be capable of generating up to 128000 tokens
an individual request still needs prompt + output to fit the provider's rules
```

Do not infer that `maxInputTokens + maxTokens` must be less than or equal to
`contextWindow`. Many provider catalogs expose separate maxima that share an
underlying context budget.

## Catalog Data vs Request Limits

The catalog should describe reported model capabilities. It should avoid baking
in Cline request defaults, product-level safety limits, or provider-specific
workarounds unless there is no better place to represent a stable fact.

The code that sends a model request is responsible for deciding how many output
tokens to ask for on that specific turn. That decision can depend on:

- actual prompt size for the current request
- provider context-window behavior
- product-level default output caps
- user overrides such as `request.options.maxTokens`
- tokenizer drift and hidden provider overhead
- reasoning, tool, image, and formatting tokens

For models where prompt and output tokens both have to fit into the same context
window, the request limit should be based on the current prompt, not invented
while generating the catalog. Conceptually:

```text
safeOutputTokens = min(
	modelReportedMaxOutput,
	contextWindow - estimatedPromptTokens - reserveTokens,
	userConfiguredOutputCap,
)
```

The SDK gateway only sends an output token limit when the caller provides
`request.options.maxTokens` or an equivalent host configuration. Catalog
metadata does not become a request parameter by itself.

The exact request-limit policy belongs in the provider/gateway/core request
path, not in generated catalog data.

## Do Not Invent Output Limits

The catalog generator should not turn ambiguous provider metadata into a new
Cline output limit.

For example, if a provider reports:

```text
limit.context = 202800
limit.output  = 202800
```

the generated catalog should preserve that reported output limit:

```text
contextWindow:  202800
maxInputTokens: 202800
maxTokens:      202800
```

Cline may still ask for fewer output tokens on a given request. That belongs in
the request path because only the request path knows the current prompt size and
the user's configured output cap.

## Generation Flow

The generated catalog is produced from the live normalizer:

```text
models.dev/api.json
	|
	v
src/catalog/catalog-live.ts
	|
	v
scripts/generate-models.ts
	|
	v
src/catalog/catalog.generated.ts
```

Use the package script when regenerating:

```bash
bun -F @cline/llms generate:models
```

Catalog changes should usually include tests in `catalog-live.test.ts` that
document how source `limit` fields map to `ModelInfo`.

## Provider Differences

Provider token semantics are not uniform:

- Some providers publish independent input and output caps.
- Some providers publish only a context budget and a max generation parameter.
- Some routed providers report limits that differ from the upstream model docs.
- Some providers reject `prompt + requestedOutput > contextWindow`.
- Some providers truncate, compress, or stop generation instead.
- Reasoning tokens may count against output budgets.
- Tool schemas, tool calls, images, and provider formatting can consume hidden
  input or output budget.

Because of those differences, catalog generation should preserve source
metadata as much as possible, while runtime request policy should be conservative
and observable.

## Related Files

- `catalog-live.ts`: normalizes live `models.dev` data.
- `catalog-live.test.ts`: tests catalog normalization behavior.
- `catalog.generated.ts`: checked-in generated provider/model catalog.
- `../../scripts/generate-models.ts`: writes generated catalog output.
- `../providers/ai-sdk.ts`: passes `maxOutputTokens` into AI SDK.
- `../providers/gateway.ts`: resolves per-request/default `maxTokens`.
