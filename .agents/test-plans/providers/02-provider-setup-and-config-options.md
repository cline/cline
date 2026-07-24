# QA prompt 2 — Provider setup from scratch, and every config option

You are doing **manual QA on the Cline VS Code extension**. Your job: for each provider in your
slice, configure it from a completely clean state through the UI, exercise every option its form
exposes, and prove a real message round-trips.

## Ground rules (do not negotiate these)

1. Every UI action goes through the `computerUse` subagent, driving a real VS Code window on
   `DISPLAY=:1`. Real clicks only — type the key into the field, click the dropdown, click Save.
2. Banned as substitutes for clicking: Playwright / `bun run e2e`, the mock API server at
   `localhost:7777` (`apps/vscode/src/test/e2e/fixtures/server`), `page.evaluate`, direct gRPC
   calls, editing `providers.json` / `globalState.json` to configure a provider, and `curl`ing a
   provider API instead of sending a chat message. Reading those files afterwards to *verify* is
   required.
3. Real network, real keys, real models.
4. A case is PASS only if you saw the expected result on screen **and** have one out-of-band
   corroboration. Statuses: PASS / FAIL / BLOCKED / SKIPPED. A provider with no available
   credential is SKIPPED — name the missing env var. Never write "should work".
5. Do not edit product code to make a test pass. Record bugs and keep going.
6. Screenshot every provider's filled-in form and its first successful reply. Record video for at
   least two providers end-to-end (one gateway, one native).

## Environment setup

```bash
cd /workspace/apps/vscode
bun run build:webview && bun esbuild.mjs

export LANE=/tmp/cline-qa/p2
mkdir -p $LANE/clinedir $LANE/userdata $LANE/workspace
printf 'export function add(a: number, b: number) {\n\treturn a + b\n}\n' > $LANE/workspace/math.ts
printf '# QA workspace\n' > $LANE/workspace/README.md
```

```bash
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-p2 -c /workspace -- bash -l
tmux -f /exec-daemon/tmux.portal.conf send-keys -t vscode-p2:0.0 \
  'env -u OPENROUTER_API_KEY -u CLINE_API_KEY -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u GEMINI_API_KEY \
   DISPLAY=:1 CLINE_DIR=/tmp/cline-qa/p2/clinedir \
   code --no-sandbox --disable-gpu --disable-workspace-trust \
   --user-data-dir=/tmp/cline-qa/p2/userdata --extensions-dir=/tmp/cline-qa/p2/userdata/exts \
   --extensionDevelopmentPath=/workspace/apps/vscode /tmp/cline-qa/p2/workspace 2>&1 | tee -a /tmp/cline-qa/p2/vscode.log' C-m
```

**The `env -u` list is load-bearing.** Provider keys in the environment are used as a fallback when
no key is stored (`sdk/packages/llms/src/providers/http.ts`), so with them set, a provider will
happily answer even if the UI never saved your key — a false PASS on the exact thing this plan
tests. Strip every provider env var, then paste keys into the form by hand. Read the real key
values out of the environment *before* launching (`echo $OPENROUTER_API_KEY`) so you have them to
type in.

To find a provider's env var name and its declared config fields:
`rg -n 'apiKeyEnv|configFields' /workspace/sdk/packages/llms/src/providers/builtins.ts`.

Dismiss VS Code's first-run dialogs, click the Cline robot icon in the Activity Bar, and on the
onboarding screen ("How will you use Cline?") pick **Bring my own API key** → **Continue**.

Reset to clean state between providers by deleting `$LANE/clinedir/data/settings/providers.json`
and relaunching, or by switching providers in the UI — do both at least once each and note any
difference.

## Providers to cover

Cover as many as you have credentials for; you must cover at least one from every archetype you
can reach. If this prompt was sharded, use only the slice you were given.

| Archetype | Provider | Notes |
|-----------|----------|-------|
| Cline gateway | `cline` | Sign-in flow, not an API key field |
| OpenAI-compatible gateway | `openrouter`, `requesty` | Live model catalog |
| Anthropic native | `anthropic` | Thinking budget, custom base URL |
| OpenAI Responses API | `openai-native` | Reasoning effort |
| Google | `gemini` | |
| Cloud credential | `bedrock`, `vertex` | AWS auth modes / GCP project+region |
| Self-hosted gateway | `litellm` | Base URL is mandatory |
| Local runtime | `ollama`, `lmstudio` | Start the local server yourself; no key |
| Custom OpenAI-compatible | `openai` | Base URL + free-text model + user-entered model info |
| Editor-hosted | `vscode-lm` | Models come from VS Code |

## Test cases

Run S1–S6 for **each** provider in your slice. Report one row per (provider, case).

### S1 — Provider picker

Open Settings (gear in the Cline navbar) → **API Configuration** → the **API Provider** combobox.
Type part of the provider name.

Expected: the search filters, the provider is selectable by both mouse and keyboard, and choosing
it swaps the form below to that provider's fields. Note any provider that is listed but renders an
obviously wrong form (e.g. a generic OpenAI-compatible form where a dedicated one is expected).

### S2 — Enumerate and fill every field

Do not work from a checklist of fields you expect; **screenshot the form and enumerate what is
actually there**, then set every one of them to a non-default value. Depending on provider that
includes: API key, base URL / "use custom base URL" toggle, custom headers, model id, custom model
id, context window size, max output tokens, temperature, reasoning effort, thinking budget,
request timeout, Azure API version and identity toggle, AWS region / auth mode / profile /
cross-region inference / global inference / prompt cache / endpoint, GCP project + region, API
line (Qwen/Moonshot/Z.ai/MiniMax), and per-model pricing inputs.

Expected for each field: it accepts input, it persists (see S4), and it has a visible effect where
one is observable. Fields worth chasing hard because they silently do nothing when broken:

- **Custom base URL** — point it at a URL you control or a deliberately wrong one and confirm the
  request actually goes there (a wrong URL must produce an error, not a silent fallback to the
  default endpoint).
- **Custom headers** — confirm they reach the server.
- **Request timeout** — set it very low (e.g. 1 ms) and confirm you get a timeout error rather
  than a hang.
- **Thinking budget / reasoning effort** — confirm reasoning content appears (or does not) in a
  way that tracks the setting.
- **Temperature / max output tokens** — confirm an extreme value visibly changes the response.

Anything you cannot observe from the UI: say so explicitly and mark that field
"set, effect unverified" rather than PASS.

### S3 — Model selection

Pick a model through whatever picker the provider offers. Where free-text model ids are allowed,
also enter one by hand.

Expected: the chosen model appears in the chat input's model chip, and in
`providers.json` under `providers.<id>.settings.model`.

### S4 — Config persists

Click Done, reopen Settings.

Expected: every value from S2 is still there, unmasked fields show what you typed, and the key
field shows a masked-but-present value. Cross-check against
`$LANE/clinedir/data/settings/providers.json`.

### S5 — Send a real message

Send `Reply with exactly: PROVIDER_OK` in Act mode.

Expected: a streamed reply, a non-zero cost badge (except local/subscription providers — see
`06-token-and-cost-accounting.md`), and a session record naming the provider and model you
selected:

```bash
for f in $LANE/clinedir/data/sessions/*/*.json; do
  case "$f" in *.messages.json) continue;; esac
  jq -c '{provider, model, usage: .metadata.usage}' "$f"
done
```

Capture the reply on screen. If the provider hangs with no error for more than ~60 s, that is a
**FAIL** (silent hang), not a BLOCKED.

### S6 — Switch away and back

Switch to a different provider, send a message, switch back.

Expected: the original provider's key, model and options are all still intact, and the second
message uses the provider actually shown in the UI. Verify the provider in the session record
matches what the UI displayed — a mismatch here is the "silent reset" bug class and is a **FAIL**.

## Report format

A matrix of `provider × S1–S6` with PASS / FAIL / BLOCKED / SKIPPED, then per-provider notes
listing every field you exercised and whether its effect was observable. One section per bug with
exact repro, screenshots, and the relevant `providers.json` excerpt (redact keys). Finish with a
list of providers you could not test and the exact credential each needs.
