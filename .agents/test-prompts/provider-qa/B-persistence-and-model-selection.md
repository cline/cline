# Provider QA B — Persistence and model selection

You are a QA agent. You drive a real VS Code window on `DISPLAY=:1` and report what you observe.

You are hunting a silent bug class: the selected provider or model reverts, nothing errors, the fallback works
fine, and the user only notices via the bill or the output quality. Because it is silent, **checking the dropdown
is not a test**. Three places hold the answer and they can disagree:

1. what the settings UI shows,
2. what is on disk,
3. where the request actually goes.

Every case passes only when all three agree, and it is the third that catches it. One such disagreement is already
confirmed — see B0, which you should run first because it changes how you interpret everything else.

## Hard rules

Violating any of these invalidates the run.

1. **Launch and stop VS Code only through `qa-env.sh`.** Never type a `code` command. Two instances sharing a
   profile attach to each other and you will test a window you did not configure.
2. **Never `kill -9` VS Code.** Use `qa-env.sh stop`, and `qa-env.sh recover` if it will not die.
3. **Never edit source code, and never "fix" anything.**
4. **Never read a value that matters off the screen.** Model ids and provider ids are small and easy to misread —
   an agent doing this run previously reported a model id as `1autlok`. Drive the UI with the screen; establish
   facts with `qa-env.sh state` and the proxy log.
5. **Report only what you observed.** Mark anything you did not do as `blocked` or `skipped`.
6. **No bug report without a reproduction.**

Stop and report if `qa-env.sh start` fails twice after a `recover`, or if `qa-env.sh doctor` blames the
environment.

## Credentials

Save exactly this as `/tmp/qa-keys.json` with your keys filled in. Most of this run needs no real key at all.

```json
{
  "anthropic":         { "apiKey": "", "model": "claude-sonnet-4-5-20250929" },
  "openai-native":     { "apiKey": "", "model": "gpt-5.1" },
  "openrouter":        { "apiKey": "", "model": "anthropic/claude-sonnet-4.5" },
  "gemini":            { "apiKey": "", "model": "gemini-2.5-pro" },
  "cline":             { "apiKey": "", "model": "anthropic/claude-sonnet-4.5" },
  "deepseek":          { "apiKey": "", "model": "deepseek-chat" },
  "groq":              { "apiKey": "", "model": "llama-3.3-70b-versatile" },
  "xai":               { "apiKey": "", "model": "grok-4" },
  "mistral":           { "apiKey": "", "model": "mistral-large-latest" },
  "requesty":          { "apiKey": "", "model": "" },
  "together":          { "apiKey": "", "model": "" },
  "vercel-ai-gateway": { "apiKey": "", "model": "" },
  "openai-compatible": { "apiKey": "qa-test-key", "baseUrl": "http://127.0.0.1:8788/v1", "model": "fault/ok" },
  "litellm":           { "apiKey": "", "baseUrl": "", "model": "" },
  "ollama":            { "baseUrl": "http://127.0.0.1:11434", "model": "" },
  "bedrock":           { "awsAccessKey": "", "awsSecretKey": "", "awsRegion": "us-west-2", "model": "anthropic.claude-sonnet-4-20250514-v1:0" },
  "vertex":            { "vertexProjectId": "", "vertexRegion": "us-east5", "model": "claude-sonnet-4@20250514" }
}
```

The `openai-compatible` entry is pre-pointed at the local fault proxy. Leave it as it is: it is your wire observer
for this whole run.

## Preflight

```bash
export QA=/workspace/.agents/test-prompts/provider-qa/fixtures
cd /workspace

bash $QA/qa-env.sh doctor            # must not report ENVIRONMENT FAILURE
bash $QA/qa-env.sh proxy start       # OpenAI-compatible mock on http://127.0.0.1:8788/v1
node $QA/apply-keys.mjs --keys /tmp/qa-keys.json --list
```

Smoke-test each real credential headlessly before using it in the UI:

```bash
rm -rf /tmp/cline-qa/smoke
node $QA/apply-keys.mjs --keys /tmp/qa-keys.json --dir /tmp/cline-qa/smoke/data --select openrouter
CLINE_DATA_DIR=/tmp/cline-qa/smoke/data timeout 120 bun run cli "Reply with exactly PONG."
```

## Commands you will use constantly

```bash
bash $QA/qa-env.sh start persist --keys /tmp/qa-keys.json --select openai-compatible
bash $QA/qa-env.sh status              # confirm exactly ONE instance
bash $QA/qa-env.sh state persist       # providers.json + legacy globalState — the on-disk truth
bash $QA/qa-env.sh proxy reset         # clear the request log before a case
bash $QA/qa-env.sh proxy models        # every request the proxy received, with its model id
bash $QA/qa-env.sh proxy tail          # last request in full: headers, body
bash $QA/qa-env.sh stop persist
```

Reaching the UI: Cline icon in the Activity Bar → gear icon in the Cline navbar → **Done** to close. Dismiss any
VS Code welcome/Copilot/theme modal first.

## The three-way check

Every case below ends the same way. Do all three, in this order, and record all three:

1. **UI** — screenshot the provider and model shown.
2. **Disk** — `bash $QA/qa-env.sh state <slug>`.
3. **Wire** — `bash $QA/qa-env.sh proxy reset`, send `Reply with exactly PONG.` in the chat, then
   `bash $QA/qa-env.sh proxy models`. The model id on the last `POST /v1/chat/completions` line is the truth.

Against a real provider instead of the proxy, substitute step 3 with a model only that provider serves, so a
fallback would visibly fail or answer as something else.

---

## B0 — Confirmed finding: the wire can disagree with both the UI and disk

**Run this first.** It is already reproduced; your job is to confirm it, establish its blast radius, and check
whether it explains anything else you see later.

Observed: an isolated run configured with model `fault/ok` sent its request as `fault/context-overflow`. Both the
settings UI and the run's own `providers.json` said `fault/ok`. The value that went on the wire came from
`~/.cline/data/globalState.json` — the *default* data directory, outside the isolated `CLINE_DATA_DIR` entirely.

Confirmed causally by editing the home file and watching the wire follow it:

```bash
cp ~/.cline/data/globalState.json /tmp/globalState.backup.json     # ALWAYS back up first

python3 -c "
import json,os
p=os.path.expanduser('~/.cline/data/globalState.json')
s=json.load(open(p))
for k in list(s):
    if isinstance(s[k],str) and s[k].startswith('fault/'): s[k]='fault/429'
json.dump(s,open(p,'w'),indent=2)
print({k:v for k,v in s.items() if 'Model' in k})
"

bash $QA/qa-env.sh stop persist
bash $QA/qa-env.sh start persist --keys /tmp/qa-keys.json --select openai-compatible
bash $QA/qa-env.sh proxy reset
# open the Cline panel, send: Reply with exactly PONG.
bash $QA/qa-env.sh proxy models
bash $QA/qa-env.sh state persist

cp /tmp/globalState.backup.json ~/.cline/data/globalState.json     # ALWAYS restore
```

The run's `providers.json` says `fault/ok`; the wire used `fault/429`; the reply rendered was the rate-limit
message. Two things follow, and you should establish both:

- **`CLINE_DATA_DIR` is not honoured for the legacy `globalState` store.** Note that the isolated data directory
  never even gains a `globalState.json`, while the home one does. Work out which writes escape isolation.
- **The effective model comes from `globalState`'s `actModeApiModelId` / `planModeApiModelId`, not from
  `providers.json`'s `model`.** So the UI and the request can disagree with nothing to warn the user.

Record: whether it reproduces for you, whether it also affects the *provider* (not just the model) — try making
the home file name a different provider — and whether changing the model in the UI updates the home file, the
isolated file, or both.

Because of B0, **every later case must use the wire check**, and if a case fails, re-check whether the home
`globalState.json` explains it before filing a separate finding.

---

## B1 — Persistence

One case each, ids as given. All use the same slug unless a case says otherwise.

| id | Scenario | Notes |
|----|----------|-------|
| `B1-reload` | Configure a non-default provider and model, run `Developer: Reload Window` from the command palette, reopen Cline | |
| `B1-restart` | `qa-env.sh stop`, then launch again **without** `--keys` so the existing data dir is reused | |
| `B1-unused` | Configure, reload immediately, then send the first message | A selection never used is the most likely to be treated as uncommitted |
| `B1-midtask` | Start a task, reload while it streams, reopen and continue | A task resuming on a different provider is severe |
| `B1-history` | Reopen a previous task from the history view | Record whether the provider follows the task or the global selection; either is acceptable, disagreement between header and wire is not |
| `B1-planact` | Enable *Use different models for Plan and Act modes*, set a different provider per tab, reload, then toggle Plan/Act several times and reload again | Mode toggling is a write path; a bad write collapses both modes |
| `B1-planact-off` | With separate models configured, turn the checkbox off, reload | The resulting single config must be predictable, not whichever mode wrote last |
| `B1-twowindows` | Not testable while `qa-env.sh` enforces one instance. Mark `skipped` and say so | |
| `B1-nokey` | Select a provider and model, never enter a key, reload | Must persist with a prompt for the key, not revert to a provider that has one |
| `B1-nostore` | Delete `providers.json`, restart; then restore it and try the reverse | Must recover coherently and say what happened |
| `B1-external` | Edit `providers.json` while VS Code runs, then reload the window | UI should reflect the file, not overwrite it from stale memory |

**PASS IF** UI, disk and wire all agree after the event.
**FAIL IF** any disagree; or the provider persists but the model reverts to a default; or plan and act collapse
onto one provider; or the request lands somewhere other than what the UI claims.

**Artifact** — one video for `B1-reload`: configure a distinctive provider and model, reload, send a message, and
end on the terminal showing `proxy models` with the expected model. One video for `B1-planact` surviving a restart.

---

## B2 — Model pickers

### B2-prefix — confirmed finding, run first

With OpenAI Compatible on the fault proxy, click the **Model ID** field, type `fault/ok`, and commit it the way a
user would. It commits `fault/ok-no-cache`: an id that is a strict prefix of another silently selects the longer
one. Confirm with `qa-env.sh state`, not by reading the field.

Establish: which interaction commits it (Enter, blur, clicking away); whether it happens with real catalog
providers that share prefixes (`gpt-4.1` and `gpt-4.1-mini`); and whether the committed value is what actually
goes on the wire.

### B2-live-<provider> — live-fetched lists

Required: `openrouter`, `requesty`, `litellm`, `ollama`. Add `lmstudio`, `groq`, `baseten`, `huggingface`,
`vercel-ai-gateway`, `cline`, `oca`, `hicap`, `vscode-lm` if credentials allow.

Per provider, in order:

1. Select the provider with **no** credential. The model area must say what is missing — not spin, not show a bare
   empty list.
2. Enter the credential (or start the local server). Record how many entries appeared and roughly how long it
   took. A list of two when the provider serves hundreds is a finding.
3. Type a substring matching several models: filtering must be live and case-insensitive. Type something matching
   nothing: expect an empty-state message, not a blank box.
4. Arrow keys move the highlight, Enter selects, Escape closes without changing the selection.
5. Select a model and confirm the model info panel updates to *that* model. A stale panel means selection and
   metadata diverged.
6. Use any refresh control and confirm a refetch (visible as a new `GET /v1/models` in `proxy models` when
   pointed at the proxy).
7. Reload the window; list repopulates and selection survives.

For `ollama` and `lmstudio`: populate with the server up, stop the server and confirm an actionable empty state,
then point the base URL at `http://127.0.0.1:8788` and confirm a custom base URL is honoured. Also point LiteLLM or
OpenAI Compatible at a URL that errors and confirm the picker reports the failure — a silent empty list is
indistinguishable from "this provider has no models".

### B2-custom — free-text ids must stick

1. Type `fault/ok` manually rather than selecting it. Send a message. `proxy models` must show `fault/ok`.
2. Type an id in no catalog anywhere: `my-org/private-model-v3`. Reload the window. It must come back verbatim
   (check with `state`).
3. Switch provider away and back; still there.
4. `qa-env.sh stop` then start again on the same data dir; still there.
5. Repeat on other manual-entry providers (LiteLLM, Ollama with a model not in the local list, the generic
   catalog-driven forms). Any provider that rewrites the id to a catalog default is a bug; note
   `providerSwitchNormalization.ts` as the suspect.
6. Edge cases: a very long id; one containing `/`, `:` and `.`; one with surrounding whitespace (should be
   trimmed); the empty string (should be rejected with a message, not saved).

### B2-dropdown — the provider dropdown itself

Search by partial name and by a name differing from the id ("claude" should surface Anthropic, "gpt" should
surface OpenAI). The × clears the search without losing the selection. Arrow-keying the list scrolls with the
highlight. Every option must render a settings form when selected; an option that selects to a blank panel is a
broken registry entry.

**Artifact** — one video: OpenRouter's list populating, being searched, a model selected, info panel updating. One
video: typing a custom model id, reloading, and the id still there, ending on `proxy models` proving the request
used it.

---

## Report

Return exactly this JSON, then a short prose summary.

```json
{
  "run": "B",
  "environment": { "doctorClean": true, "notes": "" },
  "credentials": { "usable": [], "unusable": [], "notProvided": [] },
  "confirmedFindings": {
    "B0-wire-vs-disk": { "reproduced": true, "affectsProviderToo": null, "notes": "" },
    "B2-prefix":       { "reproduced": true, "committedBy": "", "affectsRealCatalog": null, "notes": "" }
  },
  "cases": [
    { "id": "B1-reload", "status": "pass|fail|blocked|skipped",
      "ui": "", "disk": "", "wire": "", "evidence": "", "artifact": "" }
  ],
  "findings": [
    { "id": "F1", "severity": "high|medium|low", "summary": "",
      "repro": [], "expected": "", "actual": "", "evidence": "", "suspectedFile": "" }
  ]
}
```

Every `B1-*` case must carry all three of `ui`, `disk` and `wire`. A case with only `ui` filled in is not a result.
