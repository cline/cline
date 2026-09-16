# ClinePass

> Support-agent reference. Grounded on `main` @ `025baa8fb76d9bdb8a351177bc51b6c2721e18fa` (github.com/cline/cline).

## What it is

ClinePass is "a low-cost monthly subscription — **$9.99/month** — that offers **2-5x the usage** on popular open coding models compared to standard API rate" (`docs/getting-started/clinepass.mdx`). It is completely optional and works alongside any other provider.

In code it is a **separate provider** with id `cline-pass` (display name "ClinePass") that shares the same vendor module and Cline API gateway as the `cline` usage-billing provider: `sdk/packages/llms/src/providers/vendors/cline.ts` notes that both `"cline"` and `"cline-pass"` "share this AI SDK provider and the same Cline API". Provider ids: `sdk/packages/llms/src/providers/ids.ts`; spec: `builtins.ts` ("Cline API endpoint with ClinePass models").

Key distinction (from the docs page): "ClinePass is a separate provider from Cline (usage-billing). You can use both independently — subscribe to ClinePass for 2-5x the usage on popular open coding models ... or use Cline (usage-billing) for pay-as-you-go access."

## How users enable it

- Subscribe at `https://app.cline.bot/dashboard/subscription?personal=true`.
- **IDE extension:** set **API Provider** to **ClinePass** in settings and sign in.
- **CLI:** open `/settings` and select **ClinePass** as the provider.
- Authentication is the same Cline account OAuth / `CLINE_API_KEY` path as the `cline` provider (see [cline-provider.md](./cline-provider.md)).

## Models

Model ids use the `cline-pass/` prefix. The docs page (`docs/getting-started/clinepass.mdx`) lists the curated set on main: GLM-5.3/5.2 (`cline-pass/glm-5.3`, `cline-pass/glm-5.2`), Kimi K3 / K2.7 Code / K2.6, DeepSeek V4 Pro / V4 Flash, MiMo-V2.5 / V2.5-Pro, MiniMax M3, Qwen3.8 Max / Qwen3.7 Max / Qwen3.7 Plus. The live catalog is generated into `sdk/packages/llms/src/providers/providers.generated.ts`; at runtime the provider's default model is the first generated id matching `cline-pass/` (`builtins.ts`). Model tables in docs and the generated catalog can drift — the generated catalog reflects what clients actually offer.

## Usage limits

ClinePass measures usage against three limits (`clinepass.mdx`): a **5-hour rolling window**, a **weekly** (calendar week) limit, and a **monthly** (calendar month) limit. Current usage is shown on the Cline dashboard subscription page. The docs also publish reference per-1M-token prices per model to explain how usage is measured against the quota (users are not billed per token).

## Using ClinePass outside Cline clients

ClinePass models are callable from user scripts through the Cline API (OpenAI-compatible Chat Completions): create an API key at **Settings > API Keys** in app.cline.bot, then POST to `https://api.cline.bot/api/v1/chat/completions` with `Authorization: Bearer $CLINE_API_KEY` and the full slug (e.g. `"model": "cline-pass/qwen3.7-max"`). See `docs/getting-started/clinepass.mdx` and `docs/api/getting-started`.

## Error handling and support-relevant code

- `ClinePassLimitError` and not-subscribed / organization-blocked messaging live in `sdk/packages/llms/src/providers/errors.ts`; CLI-side handling in `apps/cli/src/utils/cline-pass-errors.ts`.
- ClinePass is hard-enabled across CLI, hub, and desktop code paths (`isClinePassEnabled: true`, e.g. `apps/cli/src/main.ts`, `apps/cline-hub/src/server/providers.ts`).
- The CLI can show a ClinePass promotional notice; suppress with `CLINE_DISABLE_CLINE_PASS_NOTICE=1` (`apps/cli/CHANGELOG.md`).
- The VS Code webview has promo surfaces: `useClinePassPromo`, `ClinePassCard`, `ClinePassHint` (`apps/vscode/webview-ui/src/`).

## Naming notes

Spellings that appear on main: **ClinePass** (product/display name), `cline-pass` (provider id and model-slug prefix), `clinepass` (docs URL path `docs/getting-started/clinepass.mdx`). There is no package or binary named ClinePass — it is a provider inside the existing clients.

## Common support scenarios

- "Which provider am I on?" — ClinePass and Cline (usage-billing) are selected independently in provider settings; a user can be signed in to their Cline account but still be on the wrong provider for their subscription.
- Rate-limit complaints → check the three ClinePass windows (5-hour rolling / weekly / monthly) on the dashboard before suspecting a bug.
- Subscription active but models rejected → look for the not-subscribed/limit error strings from `errors.ts`; org-level blocks are a distinct documented case.
