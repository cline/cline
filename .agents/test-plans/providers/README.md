# Provider QA test plans

Manual, UI-driven QA for LLM provider support in the **Cline VS Code extension**. Each file in
this directory is a **self-contained prompt**: copy the whole file into a fresh agent and send it.
The seven prompts are independent and are designed to run **in parallel**.

Everything here is deliberately biased toward *real* verification — a real VS Code window on a real
X display, real clicks, real provider keys, real network calls — because the bug classes being
hunted (silent provider reset, duplicated tool calls, mangled tool args, $0.00 cost, raw stack
traces) all survive mocked tests.

## The seven prompts

| # | File | Covers | Needs live keys? |
|---|------|--------|------------------|
| 1 | `01-legacy-config-migration.md` | Seeding legacy `globalState.json` / `secrets.json` and verifying migration into `providers.json`, non-destructively, with the migrated config actually usable | Yes (1–2 providers) |
| 2 | `02-provider-setup-and-config-options.md` | Setting up each provider from scratch through the UI, exercising every config field it exposes, and sending a real message | Yes (as many as possible) |
| 3 | `03-selection-persistence-on-reload.md` | Does the provider + model you picked survive reload, restart, and Plan/Act switching — the "silently resets to Anthropic" bug class | Yes (2–3 providers) |
| 4 | `04-tool-calling-per-provider.md` | Per-provider tool calling: edit a file **and** run a command; watch for double-fired tools and mangled arguments (OpenAI Responses API family especially) | Yes (per provider under test) |
| 5 | `05-model-dropdown-behavior.md` | Live-fetched model lists (OpenRouter, Requesty, LiteLLM, Ollama) populate + search; custom/free-text model IDs stick after reload | Yes (OpenRouter/Requesty), local Ollama |
| 6 | `06-token-and-cost-accounting.md` | Token counts and cost are sane per provider; cache read/write tokens appear for providers that support prompt caching | Yes |
| 7 | `07-real-error-paths.md` | Bad key (401), rate limit (429), out of credits (402), context overflow — readable errors, not raw stacks or silent hangs | Yes, plus a deliberately broken/exhausted key |

Prompts 2, 4, 5, 6 and 7 can be **sharded further by provider**: hand each agent a different slice
of the provider matrix in the "Providers to cover" section and run more lanes.

## Running them in parallel safely

Every lane must be fully isolated or the agents will fight over the same config file and produce
garbage results. Three things must differ per lane:

| Thing | How | Why |
|-------|-----|-----|
| Cline data dir | `CLINE_DIR=/tmp/cline-qa/<lane>/clinedir` | `providers.json`, `globalState.json`, secrets, sessions, and the hub daemon lock all live under here (`sdk/packages/shared/src/storage/paths.ts`) |
| VS Code profile | `--user-data-dir` + `--extensions-dir` under `/tmp/cline-qa/<lane>/` | Otherwise a second `code` invocation attaches to the first window instead of starting its own |
| Workspace folder | `/tmp/cline-qa/<lane>/workspace` | File-edit tool tests write into it |

`CLINE_DIR` isolation is verified working: launching the dev host with it set creates
`<lane>/clinedir/data/{globalState.json,settings/,db/,workspaces/}` and touches nothing in `~/.cline`.

Lane ids used by the prompts: `p1` … `p7`, matching the file numbers.

## Credentials

Provider keys are read in this precedence order (`sdk/packages/llms/src/providers/http.ts`):

1. the `apiKey` stored in `providers.json` (what the UI writes)
2. an `apiKeyResolver` (OAuth-style providers)
3. **environment variables** listed in that provider's `apiKeyEnv` (`sdk/packages/llms/src/providers/builtins.ts`)

That env fallback is a footgun for QA: a provider can appear to work with an empty key field
because `OPENROUTER_API_KEY` was inherited from the shell. Prompts that care about this launch VS
Code with `env -u` to strip provider env vars, so that only UI-entered keys are in play.

To find the exact env var name for any provider, grep its `apiKeyEnv` entry:

```bash
rg -n 'apiKeyEnv' /workspace/sdk/packages/llms/src/providers/builtins.ts
```

Keys that are not present in the environment must be added by a human in the Cursor dashboard
(Cloud Agents → Secrets). An agent that lacks a key marks those cases **SKIPPED**, never PASS.

## Dry run

The shared setup and one full slice of prompt 2 + prompt 3 were executed on this VM before these
plans were written, so the commands are known-good rather than plausible:

- built the extension, created lane `p2`, launched the dev host with `env -u` stripping
  `OPENROUTER_API_KEY`
- through the UI only: onboarding → **Bring my own API key** → provider search → **OpenRouter** →
  pasted the key → model picker populated → searched `sonnet`, then `gpt-4o-mini` → selected
  `openai/gpt-4o-mini`
- sent a message and got a real reply, which also proves the pasted key was used (the env var was
  stripped, so nothing else could have authenticated the call)
- **Developer: Reload Window** → provider, model and key all still correct, second message worked
- corroborated on disk: `providers.json` held `openai/gpt-4o-mini` with `tokenSource: "manual"`,
  and the session record showed `{"provider":"openrouter","model":"openai/gpt-4o-mini"}`

Two things that fell out of the dry run and are now baked into the plans: a phantom `sapaicore`
entry tagged `tokenSource: "migration"` appears on a clean profile (prompt 1, case M11), and the
webview's "tokens in" is the uncached remainder rather than the full prompt (prompt 6).

## Non-negotiable rules (repeated inside every prompt)

- Real clicks in a real VS Code window via the `computerUse` subagent. No Playwright, no e2e
  fixtures, no `page.evaluate`, no direct gRPC calls, no hand-editing config files to simulate a
  UI action, no `curl` to a provider as a stand-in for a chat turn.
- The Playwright mock API server (`apps/vscode/src/test/e2e/fixtures/server`, `localhost:7777`) is
  **banned**. Traffic must reach the real provider.
- Every PASS needs a screenshot taken during that step **plus** one out-of-band corroboration
  (on-disk `providers.json` / `globalState.json`, the session record under `data/sessions/`, the
  Cline output channel, or the provider's own dashboard).
- If it was not seen on screen, it is not a PASS. Statuses are PASS / FAIL / BLOCKED / SKIPPED.
- Do not modify product code to make a test pass. Report bugs; do not silently fix them.

## Evidence commands (verified working in this environment)

Every session Cline runs leaves a record under `<CLINE_DIR>/data/sessions/<id>/`:
`<id>.json` (provider, model, cumulative usage) and `<id>.messages.json` (per-message model info,
per-message metrics, tool calls). This is the corroboration the prompts ask for.

```bash
LANE=/tmp/cline-qa/p2   # your lane

# Which provider/model each task actually used, and what it cost
for f in $LANE/clinedir/data/sessions/*/*.json; do
  case "$f" in *.messages.json) continue;; esac
  jq -c '{provider, model, usage: .metadata.usage}' "$f"
done

# Per-message model + token metrics (and tool calls) for one task
jq '.messages[] | {role, modelInfo, metrics, content}' \
  $LANE/clinedir/data/sessions/<id>/<id>.messages.json

# Stored provider config, keys redacted
jq '{lastUsedProvider, providers: (.providers | map_values({model: .settings.model, tokenSource, hasKey: (.settings.apiKey != null)}))}' \
  $LANE/clinedir/data/settings/providers.json

# Mode-specific selection (the "silently reset to Anthropic" surface)
jq '{plan: .planModeApiProvider, act: .actModeApiProvider,
     planModel: .planModeApiModelId, actModel: .actModeApiModelId}' \
  $LANE/clinedir/data/globalState.json
```

A real record from a dry run of prompt 2 in this environment, for calibration:

```json
{"provider":"openrouter","model":"openai/gpt-4o-mini",
 "usage":{"inputTokens":2409,"outputTokens":7,"cacheReadTokens":2304,
          "cacheWriteTokens":0,"totalCost":0.00019275}}
```

Note that `metadata.usage.inputTokens` is the **full** prompt while the sibling
`metadata.tokensIn` is the uncached remainder (`inputTokens - cacheReads - cacheWrites`), which is
what the webview displays. Compare like with like before calling a number wrong.

## Provider archetype matrix

Testing all ~48 first-class providers by hand is not the goal; covering every **archetype** is.
Prompts reference these labels.

| Archetype | Providers | Why it is its own shape |
|-----------|-----------|-------------------------|
| Cline gateway | `cline` | First-party auth, credit balance, free models |
| OpenAI-compatible gateway | `openrouter`, `requesty`, `vercel-ai-gateway` | Live model catalog, provider-reported cost, cache pricing |
| Anthropic native | `anthropic` | Native Messages API, prompt caching, thinking budget |
| OpenAI Responses API | `openai-native`, `openai-codex` | Different wire protocol and different edit tool (`apply_patch`, not `editor`) |
| Google | `gemini`, `vertex` | Native tool blocks, cached-content tokens |
| Cloud credential | `bedrock`, `vertex` | AWS/GCP auth modes rather than an API key |
| Self-hosted gateway | `litellm` | User-supplied base URL, live model list, arbitrary model IDs |
| Local runtime | `ollama`, `lmstudio` | No key, polled model list, cost should be $0/hidden |
| Custom OpenAI-compatible | `openai` | Free-text base URL + free-text model ID + user-entered pricing |
| Editor-hosted | `vscode-lm` | Models come from VS Code, not from a key |

## Where the code lives (for evidence gathering, not for substituting reading over clicking)

| Concern | Path |
|---------|------|
| Provider picker + per-provider forms | `apps/vscode/webview-ui/src/components/settings/ApiOptions.tsx`, `.../settings/providers/` |
| Settings shell and tabs | `apps/vscode/webview-ui/src/components/settings/SettingsView.tsx` |
| Mode-specific (`planMode*` / `actMode*`) helpers | `apps/vscode/webview-ui/src/components/settings/utils/providerUtils.ts` |
| Legacy → `providers.json` migration | `sdk/packages/core/src/services/storage/provider-settings-legacy-migration.ts` |
| VS Code memento → file export | `apps/vscode/src/hosts/vscode/vscode-to-file-migration.ts` |
| Provider manifests, `apiKeyEnv`, protocol inference | `sdk/packages/llms/src/providers/builtins.ts` |
| Tool definitions and executors | `sdk/packages/core/src/extensions/tools/definitions.ts` |
| Edit-tool routing (`editor` vs `apply_patch`) | `sdk/packages/core/src/extensions/tools/model-tool-routing.ts` |
| Usage/cost normalization | `sdk/packages/llms/src/providers/ai-sdk.ts` (`normalizeUsage`) |
| Usage → chat message | `apps/vscode/src/sdk/message-translator.ts` (`normalizeUsageEvent`) |
| Error classification | `apps/vscode/src/services/error/ClineError.ts` |
| Error rendering | `apps/vscode/webview-ui/src/components/chat/ErrorRow.tsx` |
