# SDK Model Catalog Spike Findings

## 2026-05-12 — Phase 2.1 live SDK spike

Spike script:

- `src/sdk/spike/catalog-spike.ts`

Command run:

```bash
NODE_ENV=production npx tsx src/sdk/spike/catalog-spike.ts
```

`NODE_OPTIONS=--conditions=import npx tsx ...` failed in this workspace with a `tsx`/`tslib` interop error (`Cannot destructure property '__extends' ...`). The spike is therefore self-contained and dynamically imports `@clinebot/core`; `NODE_ENV=production` is the working command for this repository.

SDK package:

- `@clinebot/core@0.0.38`

SDK APIs verified:

- `resolveProviderConfig(providerId, modelCatalog?, config?)`
- `getLocalProviderModels(providerId, config?)`
- `ProviderSettingsManager.getProviderConfig(providerId, { includeKnownModels: false })`

Model catalog options used:

```ts
{
  loadLatestOnInit: true,
  loadPrivateOnAuth: true,
  failOnError: false,
  cacheTtlMs: 0,
}
```

## Provider results

### DeepSeek

Input config came from `providers.json` / SDK migration with no API key present and base URL `https://api.deepseek.com/v1`.

`resolveProviderConfig("deepseek", ...)` returned:

- default model id: `deepseek-v4-flash`
- known model count: `4`
- first model id: `deepseek-v4-flash`
- first raw model info fields:
  - `capabilities`
  - `contextWindow`
  - `family`
  - `id`
  - `maxTokens`
  - `name`
  - `pricing`
  - `releaseDate`
  - `status`
- representative capabilities: `tools`, `reasoning`, `structured_output`, `temperature`, `prompt-cache`
- representative pricing fields: `input`, `output`, `cacheRead`, `cacheWrite`

`getLocalProviderModels("deepseek", ...)` returned 4 UI-shaped models. Its first entry was legacy-ish (`deepseek-chat`) and less rich than `knownModels`; prefer `resolveProviderConfig(...).knownModels` for catalog metadata.

Exit criterion met: DeepSeek returned >= 4 SDK known models.

### Ollama

Input config used base URL `http://localhost:11434/v1` and no API key. Local Ollama was reachable in this environment.

`resolveProviderConfig("ollama", ...)` returned:

- default model id: `default`
- known model count: `1`
- first model id: `phi4-mini:latest`
- first raw model info fields:
  - `capabilities`
  - `contextWindow`
  - `id`
  - `maxTokens`
  - `name`
  - `releaseDate`
  - `status`
- representative capabilities: `streaming`, `tools`

`getLocalProviderModels("ollama", ...)` returned 1 UI-shaped model: `phi4-mini:latest`.

Exit criterion met: Ollama returned locally installed models.

### LiteLLM

Input config used fallback base URL `http://localhost:4000/v1` and no API key. No local LiteLLM dynamic server appears to be required for SDK fallback behavior in this run.

`resolveProviderConfig("litellm", ...)` returned:

- default model id: `gpt-5.4`
- known model count: `1`
- first model id: `gpt-5.4`
- first raw model info fields:
  - `id`
  - `name`

`getLocalProviderModels("litellm", ...)` returned 1 UI-shaped model: `gpt-5.4`.

Surprise: LiteLLM fallback metadata is very sparse (`id`, `name` only). Shape adapter must default missing fields safely and preserve richer extension/fetched metadata when available.

### OpenRouter

Input config used SDK fallback/default settings with no API key present.

`resolveProviderConfig("openrouter", ...)` returned:

- base URL: `https://openrouter.ai/api/v1`
- default model id: `anthropic/claude-sonnet-4.6`
- known model count: `158`
- first model id in returned object order: `x-ai/grok-4.3`
- first raw model info fields:
  - `capabilities`
  - `contextWindow`
  - `family`
  - `id`
  - `maxTokens`
  - `name`
  - `pricing`
  - `releaseDate`
  - `status`
- representative capabilities: `images`, `tools`, `reasoning`, `structured_output`, `temperature`, `prompt-cache`
- representative pricing fields: `input`, `output`, `cacheRead`, `cacheWrite`

`getLocalProviderModels("openrouter", ...)` returned 155 UI-shaped models. Its count differs from `knownModels` and it appears less metadata-rich; prefer `resolveProviderConfig(...).knownModels` for the host catalog response.

## Shape observations

Raw SDK `knownModels` entries use this broad shape:

```ts
{
  id: string,
  name?: string,
  contextWindow?: number,
  maxTokens?: number,
  capabilities?: string[],
  pricing?: {
    input?: number,
    output?: number,
    cacheRead?: number,
    cacheWrite?: number,
  },
  releaseDate?: string,
  family?: string,
  status?: string,
}
```

Sparse entries are valid in SDK output (LiteLLM had only `id` and `name`). The Phase 2.2 adapter must validate required minimum shape (`id` string is the only field consistently present in this spike) and default optional extension `ModelInfo` fields explicitly.

## Decision

Use `resolveProviderConfig(providerId, modelCatalog, effectiveProviderConfig).knownModels` as the primary host-side model catalog source for Phase 2.2/3. Use `getLocalProviderModels` only as a secondary UI-shape comparison or compatibility fallback; it loses metadata and can return different model counts/order.
