# Provider QA B — Does what you picked stay picked?

Two halves of the same question. Can the user pick the model they want in the first place, and does that choice
survive everything that happens afterwards?

The bug class being hunted is silent: the selection reverts, nothing errors, the fallback provider works fine, and
the user only notices via the bill or the output quality. So **checking the dropdown is not a test**. There are
three places the answer lives and they can disagree — what the UI shows, what is on disk, and where the next
request actually goes. Every scenario below passes only when all three agree, and it is the third that catches it.

Report using the template at the bottom. Record video.

## Your credentials

Save this as `/tmp/qa-keys.json` and fill in whatever you have. Empty strings are skipped. Most of this run works
without any real key, so an unfilled file still gets you most of the coverage.

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
  "openai-compatible": { "apiKey": "", "baseUrl": "", "model": "" },
  "litellm":           { "apiKey": "", "baseUrl": "", "model": "" },
  "ollama":            { "baseUrl": "http://127.0.0.1:11434", "model": "" },
  "bedrock":           { "awsAccessKey": "", "awsSecretKey": "", "awsRegion": "us-west-2", "model": "anthropic.claude-sonnet-4-20250514-v1:0" },
  "vertex":            { "vertexProjectId": "", "vertexRegion": "us-east5", "model": "claude-sonnet-4@20250514" }
}
```

Confirm which credentials are usable before touching the UI:

```bash
cd /workspace
node .agents/test-prompts/provider-qa/fixtures/apply-keys.mjs --keys /tmp/qa-keys.json --list

export SMOKE=/tmp/cline-qa/smoke
rm -rf "$SMOKE" && node .agents/test-prompts/provider-qa/fixtures/apply-keys.mjs \
  --keys /tmp/qa-keys.json --dir "$SMOKE/data" --select openrouter
CLINE_DATA_DIR="$SMOKE/data" bun run cli "Reply with exactly PONG."
```

## Environment

```bash
export QA=/tmp/cline-qa/persistence
rm -rf "$QA" && mkdir -p "$QA/workspace"
printf 'export const name = "john"\n' > "$QA/workspace/qa.txt"
cd /workspace/apps/vscode && bun run build:webview && bun esbuild.mjs   # only if dist/extension.js is stale

# Wire observer. Whichever provider a request lands on, you can prove it here.
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s fault-proxy -- \
  node /workspace/.agents/test-prompts/provider-qa/fixtures/fault-proxy.mjs

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-qa -- \
  env DISPLAY=:1 CLINE_DATA_DIR="$QA/data" \
  code --no-sandbox --disable-workspace-trust --user-data-dir="$QA/vscode-userdata" \
       --extensionDevelopmentPath=/workspace/apps/vscode "$QA/workspace"
```

The fault proxy is an OpenAI-compatible endpoint at `http://127.0.0.1:8788/v1`; configure it as **OpenAI
Compatible** with any non-empty key. It serves a list of `fault/*` models from `/v1/models`, so it also exercises
live model-list fetching, and it logs every request to `/tmp/fault-proxy.jsonl`.

Operational rules, learned the hard way:

- **One VS Code instance at a time.** A second `code` with the same `--user-data-dir` attaches to the first, and
  you will silently test the wrong window. Check `ps -eo pid,args | grep [e]xtensionDevelopmentPath` around every
  launch. This matters more in this run than any other, because you restart VS Code constantly.
- **Never `kill -9` VS Code.** It poisons the profile and every later launch dies with *"The window terminated
  unexpectedly (reason: 'crashed', code: '133')"*. Use `kill -TERM` and wait for the process to go.
- **On crash 133**, kill the process, `rm -rf "$QA/vscode-userdata"`, relaunch. Note that this deletes the VS Code
  profile but **not** `$QA/data`, so the Cline state under test is preserved — which is exactly what you want
  mid-run. If a plain `code` with no `--extensionDevelopmentPath` also crashes, the display is degraded; report it
  as an environment failure rather than a Cline bug.

Reaching the settings: Cline icon in the Activity Bar → gear icon in the Cline navbar → **Done** to close.

## The state-inspection command

You will run this constantly. Provider credentials and the active-provider pointer both live in `providers.json`;
`globalState.json` is the older store and may not exist on a fresh install. Divergence between the two is itself a
finding.

```bash
echo "--- providers.json ---"; cat "$QA/data/settings/providers.json"
echo "--- globalState ---";    python3 -c "import json,os;p='$QA/data/globalState.json';print({k:v for k,v in json.load(open(p)).items() if 'ApiProvider' in k or 'ModelId' in k or k=='mode'} if os.path.exists(p) else '(absent)')"
```

## The verification every scenario ends with

After the reload, restart or switch, send `Reply with exactly PONG.` and confirm the request landed where you
expect. Against the fault proxy, `tail -1 /tmp/fault-proxy.jsonl` proves it outright. Against a real provider, pick
a model only that provider serves so a fallback would visibly fail or answer as something else. Do not skip this
step — it is the only one that catches a UI that is lying about the current provider.

## Part 1 — Persistence

1. **Reload the window.** Configure a non-default provider and model, run `Developer: Reload Window`, check all
   three sources.
2. **Full restart.** Close VS Code, relaunch with the same `CLINE_DATA_DIR`.
3. **Configure then reload before sending anything.** A selection that was never used is the most likely to be
   treated as uncommitted.
4. **Reload mid-task.** Start a task, reload while it streams, reopen and continue. A task resuming on a different
   provider is a severe variant.
5. **Reopen from history.** Note whether the provider follows the task or the current global selection, and confirm
   the header and the actual request agree either way.
6. **Plan/Act separate models.** Enable *Use different models for Plan and Act modes*, set a different provider per
   tab, reload. Then toggle between Plan and Act several times and reload again — mode toggling is a write path,
   and a bad write here collapses both modes onto one provider.
7. **Plan/Act toggled back off.** The resulting single configuration should be predictable, not whichever mode
   wrote last.
8. **Two windows.** Open a second VS Code on the same `CLINE_DATA_DIR`. Change the provider in window A and check
   window B. It may or may not live-update, but it must never show one provider while disk holds another.
9. **No credential.** Select a provider and model but never enter a key, then reload. The selection must persist
   with a prompt for the key, not revert to a provider that does have one — that is the silent-reset symptom
   exactly.
10. **Corrupt one store.** Delete `providers.json` and relaunch; then try the reverse. Both directions should
    recover to something coherent and say what happened.
11. **Edited outside the UI.** Change `providers.json` while VS Code is running, then reload the window. The UI
    should reflect the file rather than overwrite it from stale in-memory state.

Failure looks like: the dropdown showing a different provider after a reload; the dropdown being right while disk
disagrees; the provider persisting but the model reverting to a default; plan and act collapsing; a request landing
somewhere other than what the header claims.

## Part 2 — Model pickers

### Start here: a confirmed autocomplete defect

With OpenAI Compatible pointed at the fault proxy, click the Model ID field, type `fault/ok`, and commit it the way
a user would. The field commits `fault/ok-no-cache`: a model id that is a strict prefix of another selects the
longer one, silently. Reproduce it, work out which interaction commits it (Enter, blur, clicking away), check
whether it also happens with real catalog providers that have prefix-sharing ids — `gpt-4.1` and `gpt-4.1-mini` are
the obvious pair — and confirm whether the committed value is what actually gets sent. Everything else below
depends on this field working, so pin it down first.

### Live-fetched lists

Test `openrouter`, `requesty`, `litellm` and `ollama` at minimum; add `lmstudio`, `groq`, `baseten`,
`huggingface`, `vercel-ai-gateway`, `cline`, `oca`, `hicap`, `vscode-lm` if you can.

Per provider: with no credential the model area should say what is missing rather than spin or show a bare empty
list. With the credential, the list must populate — record roughly how many entries and how long it took, since a
list of two when the provider serves hundreds is a finding. Search must filter live and case-insensitively, and a
no-match search must produce an empty-state message. Arrow keys move, Enter selects, Escape cancels. Selecting a
model must update the model info panel (context window, pricing); a stale panel means selection and metadata have
diverged. Use any refresh control and confirm it refetches. Then reload the window and confirm both the list and
the selection come back.

For `ollama` and `lmstudio` specifically: populate with the server running, then stop the server and confirm you
get an actionable empty state, then point the base URL at `http://127.0.0.1:8788` and confirm a custom base URL is
honoured. Also point LiteLLM or an OpenAI Compatible provider at a URL that errors, and confirm the picker reports
the fetch failure — a silent empty list is indistinguishable from "this provider has no models".

### Custom model ids must stick

1. Type `fault/ok` manually rather than selecting it, send a message, and confirm `tail -1
   /tmp/fault-proxy.jsonl` shows `"model": "fault/ok"`.
2. Type an id in no catalog anywhere — `my-org/private-model-v3`. Reload the window; it must come back verbatim.
3. Switch provider away and back; still there.
4. Restart VS Code entirely; still there.
5. Repeat on the other manual-entry providers (LiteLLM, Ollama with a model not in the local list, the generic
   catalog-driven forms). Any provider that rewrites the id to a catalog default is a bug — look at
   `providerSwitchNormalization.ts`.
6. Edge cases: a very long id; one with `/`, `:` and `.`; one with surrounding whitespace (should be trimmed); the
   empty string (should be rejected with a message, not saved).

### The provider dropdown itself

Search by partial name and by a name that differs from the id — "claude" should surface Anthropic, "gpt" should
surface OpenAI. The × clears the search without losing the current selection. Arrow-keying the whole list scrolls
with the highlight. Every option in the list must render a settings form when selected; an option that selects to a
blank panel is a broken registry entry.

## Artifacts

- One video: configure a distinctive provider and model, reload the window, send a message that visibly lands on
  the same provider. This is the headline artifact.
- One video: plan/act separate models surviving a full restart.
- One video: typing a custom model id, reloading, and the id still being there — ending on the proxy log proving
  the request used it.
- Screenshots of the settings UI beside the on-disk state for any mismatch.

## Report

**Persistence:** a table of the eleven scenarios with a three-way result each (UI / disk / wire). For any mismatch,
the exact sequence, both files before and after, and which store you believe is wrong.

**Model pickers:** a table of provider, list populated (Y/N + count), search works, selection commits, survives
reload. Then a separate list of every provider whose custom model id did not survive, because those are the silent
ones.
