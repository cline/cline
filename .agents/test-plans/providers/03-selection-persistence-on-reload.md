# QA prompt 3 — Does the provider + model you picked stay picked?

You are doing **manual QA on the Cline VS Code extension**. Your job: hunt a specific, recurring
bug class — the selected provider/model silently reverting (historically to Anthropic, or to a
provider's default model) with no error shown. Nothing about this bug announces itself, so the
whole plan is "set it, disturb it, look again, and check three places agree".

The three places that must agree after every disturbance:

1. the **chat input's model chip** (what the user thinks they are using)
2. **Settings → API Configuration** (provider dropdown + model picker)
3. **disk** — `providers.json` (`lastUsedProvider`, `providers.<id>.settings.model`) and
   `globalState.json` (`planModeApiProvider` / `actModeApiProvider` and the matching model keys)

A disagreement between any two of them is a **FAIL**, even if the message still sends.

## Ground rules (do not negotiate these)

1. Every UI action goes through the `computerUse` subagent, driving a real VS Code window on
   `DISPLAY=:1`. Real clicks only.
2. Banned as substitutes for clicking: Playwright / `bun run e2e`, the mock API server at
   `localhost:7777`, `page.evaluate`, direct gRPC calls, and editing config files to set up state.
   Reading those files to *verify* is required.
3. Real network, real keys, real models.
4. PASS requires seeing it on screen **and** a matching on-disk value. Statuses: PASS / FAIL /
   BLOCKED / SKIPPED. Never write "should work".
5. Do not edit product code. Record bugs and keep going.
6. Record video for R2 (reload) and R7 (crash/restart) — those are the ones people will want to
   watch.

## Environment setup

```bash
cd /workspace/apps/vscode
bun run build:webview && bun esbuild.mjs

export LANE=/tmp/cline-qa/p3
mkdir -p $LANE/clinedir $LANE/userdata $LANE/workspace
printf 'export function add(a: number, b: number) {\n\treturn a + b\n}\n' > $LANE/workspace/math.ts
```

```bash
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-p3 -c /workspace -- bash -l
tmux -f /exec-daemon/tmux.portal.conf send-keys -t vscode-p3:0.0 \
  'DISPLAY=:1 CLINE_DIR=/tmp/cline-qa/p3/clinedir \
   code --no-sandbox --disable-gpu --disable-workspace-trust \
   --user-data-dir=/tmp/cline-qa/p3/userdata --extensions-dir=/tmp/cline-qa/p3/userdata/exts \
   --extensionDevelopmentPath=/workspace/apps/vscode /tmp/cline-qa/p3/workspace 2>&1 | tee -a /tmp/cline-qa/p3/vscode.log' C-m
```

Reload = Command Palette (`Ctrl+Shift+P`) → **Developer: Reload Window**.
Restart = kill the PID from `pgrep -f extensionDevelopmentPath` (never `pkill -f`) and relaunch the
tmux command.

Useful watch loop in a second terminal:

```bash
watch -n2 'jq "{last: .lastUsedProvider, models: (.providers | map_values(.settings.model))}" \
  /tmp/cline-qa/p3/clinedir/data/settings/providers.json; \
  jq "{plan: .planModeApiProvider, act: .actModeApiProvider, planModel: .planModeApiModelId, actModel: .actModeApiModelId}" \
  /tmp/cline-qa/p3/clinedir/data/globalState.json'
```

## Selections to test

Use at least three, and deliberately include a provider whose model id looks nothing like an
Anthropic model id so a silent reset is obvious:

| Provider | Pick a model like |
|----------|-------------------|
| `openrouter` | a non-Anthropic model, e.g. a Llama or DeepSeek route |
| `openai-native` | a GPT model |
| `cline` | a non-default model from the picker |
| `ollama` (if a local server is running) | any pulled model |

## Test cases

Run R1–R9 for each selection.

### R1 — Baseline

Select provider + model in Settings, close Settings, send one message.

Expected: all three places agree, and the session record names the same provider and model:

```bash
for f in /tmp/cline-qa/p3/clinedir/data/sessions/*/*.json; do
  case "$f" in *.messages.json) continue;; esac
  jq -c '{provider, model}' "$f"
done
```

This last check is the one that separates "displayed wrong" from "actually used wrong" — run it
after every case below, not just this one.

### R2 — Reload window (record video)

Reload the window. Wait for the Cline sidebar to finish loading, then check all three places
*before* touching anything.

Expected: identical to R1. Pay attention to the first second after load — a chip that renders
correctly and then flips is still a FAIL; note the timing.

### R3 — Reload with Settings left open

Reopen Settings, leave it on API Configuration, reload.

Expected: same selection, settings view restores without resetting the dropdown.

### R4 — Cold restart of VS Code

Kill and relaunch.

Expected: same selection.

### R5 — Plan/Act, shared config

With **Use different models for Plan and Act modes** unchecked, toggle Plan↔Act several times,
reload, toggle again.

Expected: both modes always show the same provider+model, and `planModeApiProvider` equals
`actModeApiProvider` on disk at all times.

### R6 — Plan/Act, separate config

Check **Use different models for Plan and Act modes**, set two genuinely different providers,
reload, toggle modes.

Expected: each mode keeps its own provider+model across reload; switching modes swaps the chip;
neither mode leaks into the other. Then **uncheck** the box and confirm the documented behavior
(the active sub-tab's config is copied to both modes) actually happens rather than one mode
reverting to a default.

### R7 — Reload mid-stream (record video)

Start a long response, then reload the window while tokens are still streaming.

Expected: after reload the provider+model are unchanged and the task is in a sane state. A reset
here would be easy to miss because attention is on the interrupted task.

### R8 — Second workspace

Open a second folder in a new window against the same `CLINE_DIR`, check the selection there, and
change it; then check the first window.

Expected: provider selection is global, both windows converge, and neither silently reverts.

### R9 — Provider that needs a refresh to resolve its model

Pick a provider whose model list is fetched live (OpenRouter, Requesty, LiteLLM, Ollama), select a
model, then reload **with the network to that provider unavailable** (e.g. set a bogus base URL,
or block it) and check the chip.

Expected: the selection is remembered and the failure to *list* models does not silently rewrite
the *selected* model. Falling back to a default model or to Anthropic here is a FAIL and is a
plausible root cause for the whole bug class — dig in if you see it.

## Extra evidence to capture on any FAIL

- exact timestamp, and the `providers.json` / `globalState.json` contents immediately before and
  after (`cp` them, don't paraphrase)
- the Cline output channel around that timestamp
- whether the wrong provider was actually *used* for the next request (session record) or merely
  displayed wrong

## Report format

A matrix of `selection × R1–R9`. For every FAIL, a minimal repro (the shortest click sequence that
reproduces it), the before/after config diffs, screenshots, and the videos for R2/R7. State plainly
at the top whether you were able to reproduce a silent reset at all.
