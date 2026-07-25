# Provider QA — Run A findings (setup and migration)

Observed against `apps/vscode` (`claude-dev`) built from commit `2c64c4ce5`, driven through
`fixtures/qa-env.sh` on `DISPLAY=:1`. No product source was modified during this run.

Credentials available: `anthropic`, `openai-native`, `openrouter`, `cline`, `vercel-ai-gateway`
(all five verified usable headlessly before any UI work). No credential was provided for
`gemini`, `deepseek`, `groq`, `xai`, `mistral`, `requesty`, `together`, `openai-compatible`,
`litellm`, `bedrock` or `vertex`; no Ollama server was listening on `127.0.0.1:11434`.

## F1 — The VS Code extension ignores `CLINE_DATA_DIR` for `globalState.json` and `secrets.json`

`createStorageContext()` resolves its data directory from `CLINE_DIR` or `~/.cline` only:

```ts
// apps/vscode/src/shared/storage/storage-context.ts
const clineDir = opts.clineDir || process.env.CLINE_DIR || path.join(os.homedir(), ".cline")
const dataDir = path.join(clineDir, SETTINGS_SUBFOLDER)
```

`CLINE_DATA_DIR` is not consulted, even though `resolveDataDir()` in
`apps/vscode/src/sdk/legacy-state-reader.ts` and `resolveClineDataDir()` in
`@cline/shared` both honour it, and the CLI honours it. The result is a split store: the SDK
writes `settings/providers.json`, `db/` and `sessions/` into `CLINE_DATA_DIR`, while the
extension writes `globalState.json`, `secrets.json` and `workspaces/*/workspaceState.json`
into `~/.cline/data`.

Five runs, each with a distinct empty `CLINE_DATA_DIR`, left every per-run directory without a
`globalState.json` or `secrets.json`, and accumulated four unrelated API keys in the one shared
file. Launching the same slugs with `CLINE_DIR` pointed at the same directory puts both files
where they belong, which isolates the cause to the missing `CLINE_DATA_DIR` branch.

Three user-visible consequences were observed:

1. `welcomeViewCompleted` persists outside the data directory, so a genuinely empty data
   directory skips onboarding and opens straight into chat.
2. The provider, model and API key from a previous, unrelated data directory are active in the
   new one. A fresh directory answered `Reply with exactly PONG.` over
   `anthropic` / `claude-sonnet-4-5-20250929` and billed $0.0136 to a key that had never been
   entered there.
3. After a legacy config migrated correctly into `CLINE_DATA_DIR`, the UI opened on a provider
   from a different directory and the request used it — see F5.

## F2 — Provider search matches display names only, so `claude` misses Anthropic and `gpt` misses OpenAI

`ApiOptions.tsx` builds its Fuse index from the provider label alone
(`searchableItems = providerOptions.map(o => ({ value: o.value, html: o.label }))`), with no
aliases or keywords. Reproduced headlessly against the live catalog (174 providers):

| query | results | Anthropic / OpenAI present |
| --- | --- | --- |
| `claude` | Claude Code, Claudinio | no |
| `gpt` | NanoGPT, OpenAI ChatGPT Subscription | no |

Both misses were then confirmed in the UI. `claude` is actively misleading, because
"Claude Code" is a different provider that needs the Claude CLI installed.

## F3 — Upgrading users are sent back through onboarding

`migrateWelcomeViewCompleted()` reads `context.secrets` / `context.globalState`, i.e. VS Code's
own per-profile stores, while provider credentials now live in the file-backed store. A data
directory whose legacy config is the `globalState.json` + `secrets.json` pair therefore yields
`hasKey === false` and `welcomeViewCompleted` is set to `false`, even though the migration
already produced a complete `providers.json`.

Observed for the `anthropic` shape: onboarding appeared; the provider form behind
**Bring my own API key** was correctly pre-filled with Anthropic, the legacy model and a masked
key, and clicking through worked. The credential is not lost — the user is just asked to
re-confirm setup after an upgrade, and the header icons are inert until they do.

## F4 — 25 providers are never migration candidates, so their stored keys never reach `providers.json`

`collectCandidateProviderIds()` adds only 11 provider ids from stored secrets, plus whatever is
named in `actModeApiProvider` / `planModeApiProvider`. `buildLegacyProviderSettings()` can map
34. The 26-id difference (25 real, plus `openai`, which is covered separately via
`LEGACY_OPENAI_COMPATIBLE_PROVIDER_ID`) is silently skipped:

```
aihubmix, asksage, baseten, cerebras, deepseek, dify, doubao, fireworks, groq, hicap,
huawei-cloud-maas, huggingface, litellm, minimax, mistral, moonshot, nebius, nousResearch,
qwen, requesty, sambanova, together, vercel-ai-gateway, xai, zai
```

The `many-keys` shape seeds nine credentials and migrates three (`gemini`, `anthropic`,
`openrouter`). An isolation run pins the cause on the candidate set rather than the field
mapping: the same `deepSeekApiKey` migrates correctly when `deepseek` is the selected provider,
and is dropped when `gemini` is selected instead.

Two things mask this. The legacy `secrets.json` is not deleted, so the provider form still
renders the key as masked dots — a user checking DeepSeek sees a credential that
`providers.json` does not have. And selecting such a provider in the UI writes it into
`actModeApiProvider`, so a later migration pass can pick it up; `groq` gained an entry with
`tokenSource: "migration"` this way mid-run, while `deepseek`, `mistral` and `xai` did not.

## F5 — `split-plan-act` loses the Act-mode model, and the user is not told

Confirms the finding supplied with the prompt. Seeded plan = `anthropic` /
`claude-opus-4-1-20250805`, act = `openrouter` / `z-ai/glm-4.6`, `mode: "plan"`. Both providers
and both keys migrate, but the OpenRouter entry holds `anthropic/claude-sonnet-4.6`, the catalog
default, because `migrateLegacyProviderSettings` applies the single `globalState.mode` to every
candidate, so `resolveModelForProvider` looks for `planModeOpenRouterModelId`, finds nothing and
falls through to `getDefaultModelForProvider`.

UI behaviour added by this run: switching to Act mode produced no notification, banner or toast
of any kind. The Act-mode request did not use `z-ai/glm-4.6`, and it did not use the migrated
OpenRouter default either — it used `vercel-ai-gateway` / `alibaba/qwen3.6-plus`, leaked from a
previous data directory per F1.

## Cases that behaved correctly

- Migration of the `anthropic`, `openrouter`, `openai-compatible`, `bedrock` and `ollama` shapes
  preserved key, model, base URL, custom headers, timeout, AWS region and prompt-cache flags,
  and tagged every entry `tokenSource: "migration"`. Bedrock's `awsAuthentication: "credentials"`
  maps to `authentication: "iam"` by design.
- A request per shape reached the provider the legacy config named, identified by
  provider-specific error text (OpenRouter "Missing Authentication header", Anthropic
  "invalid x-api-key", AWS "The security token included in the request is invalid.",
  Gemini "API key not valid.", and a connection refusal to the migrated
  `https://legacy.example.invalid/v1`).
- Re-running migration is byte-identical: no duplicates, no changed values.
- A user model edit survives re-migration; the legacy model is not resurrected.
- A legacy config missing its model id yields the provider with a sane catalog default rather
  than a blank dropdown.
- A `globalState.json` containing only `{` leaves the webview fully rendered and interactive;
  the credential is salvaged from `secrets.json` and the onboarding form offers an unconfigured
  provider. Nothing tells the user the file was unreadable, but nothing breaks.
- The Cline OAuth flow opens VS Code's external-website prompt for
  `https://authkit.cline.bot/device?user_code=…`, shows the device code in the panel, and
  cancelling leaves the UI fully usable. The browser opened on `DISPLAY=:1` and reached the
  device page before the container killed it.

## Harness note

`qa-env.sh status` counts processes by `pgrep -f -- "--extensionDevelopmentPath=$REPO/apps/vscode"`,
which also matches any shell whose own command line contains that string. It reported
"MORE THAN ONE INSTANCE" while exactly one VS Code window existed; the distinct
`--user-data-dir` values and the X window count are the reliable checks.
