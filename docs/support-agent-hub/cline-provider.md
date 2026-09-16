# Cline Provider (Cline Usage-Billing)

> Support-agent reference. Grounded on `main` @ `025baa8fb76d9bdb8a351177bc51b6c2721e18fa` (github.com/cline/cline).

## What it is

The **Cline provider** (provider id `cline`, display name **"Cline Usage-Billing"**) is Cline's first-party, pay-as-you-go LLM provider. Instead of managing separate vendor API keys, users sign in once, add **Cline credits**, and select from 100+ models routed through Cline's OpenAI-compatible API gateway. Docs page: `docs/getting-started/cline-provider.mdx`; implementation: `sdk/packages/llms/src/providers/builtins.ts` (`createClineLikeSpec`, `id: "cline"`) and `sdk/packages/llms/src/providers/vendors/cline.ts`.

It is the **default provider** in the CLI (`-P, --provider` defaults to `cline`, `apps/cli/README.md`). It is distinct from [ClinePass](./cline-pass.md) (`cline-pass`), the flat-rate subscription provider — both share the same vendor module and Cline API but are separate providers users can hold independently.

## Endpoints and environment

From `sdk/packages/shared/src/runtime/cline-environment.ts` and the provider spec:

- API base: `https://api.cline.bot`; provider base URL `https://api.cline.bot/api/v1` (chat completions at `/api/v1/chat/completions`, images at `/api/v1/images`).
- Web app / dashboard: `https://app.cline.bot` (credits, usage, API keys, organizations).
- Env overrides for development: `CLINE_ENVIRONMENT`, `CLINE_API_BASE_URL` (staging/local bases defined in the same file).
- API key env var: `CLINE_API_KEY` (`apiKeyEnv` in `builtins.ts`; also usable for direct API calls per `docs/getting-started/clinepass.mdx` and `docs/api/`).
- Default model: `CLINE_DEFAULT_MODEL_ID = "anthropic/claude-sonnet-5"` (`sdk/packages/shared/src/providers/defaults.ts`).

## Authentication

- **CLI:** `cline auth` opens the interactive auth TUI (options: Sign in with Cline, Sign in with ChatGPT Subscription via `openai-codex`, Sign in with OCA, or bring your own API key). `cline auth cline` runs the OAuth sign-in directly (`apps/cli/README.md`, `apps/cli/src/commands/auth.ts`).
- **OAuth mechanism:** WorkOS device auth by default (`loginClineOAuth` with `useWorkOSDeviceAuth ?? true` in `sdk/packages/core/src/auth/cline.ts`; per-environment WorkOS client IDs in `cline-environment.ts`). Stored tokens are often prefixed `workos:`.
- **IDE extension:** set API Provider to **Cline** in settings and click **Sign In** (`docs/getting-started/authorizing-with-cline.mdx`).
- **Headless/CI:** OAuth providers never auto-launch a browser on normal startup. "For non-interactive runs, if an OAuth provider is selected and no saved credentials are available, `cline` fails fast with an authentication message instead of launching a hidden browser flow" (`apps/cli/README.md`). Authenticate first with `cline auth <provider>` or pass `CLINE_API_KEY`.
- Credentials persist in `~/.cline/data/settings/providers.json` with `tokenSource: "manual" | "oauth" | "migration"` (see [cline-configuration.md](./cline-configuration.md)).

## Billing model

Per `docs/getting-started/cline-provider.mdx`:

- Pay-as-you-go **Cline credits**, added from the [dashboard](https://app.cline.bot/dashboard); one balance across supported models.
- Free options exist — models tagged **FREE** in the selector.
- Usage visible in Cline Settings → **View Usage**; organization switching in Settings → **Switch Organization**.

## Common failure modes (documented in-repo)

- **No credentials:** default `cline` provider fails fast with an `Unauthorized` error (root `AGENTS.md`); headless tests expect `/Unauthorized|Missing API key/i` (`apps/cli/src/tests/headless/headless.test.ts`). Fix: `cline auth` or set `CLINE_API_KEY`.
- **Expired session:** "Unauthorized: Please sign in" → re-authenticate (troubleshooting table in `docs/getting-started/authorizing-with-cline.mdx`). The API-style message "Unauthorized: Please make sure you're using the latest version of Cline and re-authenticate your Cline account." appears in orchestrator tests; the string originates server-side, not from a single in-repo throw site.
- **Org access issues:** verify membership at app.cline.bot; sign out/in (same troubleshooting table).
- Provider error mapping lives in `sdk/packages/llms/src/providers/errors.ts` (includes free-model limit errors and ClinePass-specific errors).

## Support notes

- Do not confuse a hub WebSocket `401 Unauthorized` (local hub auth token, see [cline-hub.md](./cline-hub.md)) with a Cline provider `Unauthorized` (account/credential issue).
- "Cline" appears as three different things in provider discussions: the product, the `cline` provider id (usage-billing), and the `cline-pass` provider id (ClinePass). The docs deliberately write "Cline (usage-billing)" for the provider.
- Known minor drift on main: root `package.json` defines `verify:workos-device-auth` pointing at `sdk/scripts/verify-workos-device-auth.ts`, but that script file does not exist at this commit.
