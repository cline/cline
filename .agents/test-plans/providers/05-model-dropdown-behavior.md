# QA prompt 5 — Model dropdown behavior

You are doing **manual QA on the Cline VS Code extension**. Your job: the model pickers. The ones
that fetch their list live must actually populate and search, and free-text / custom model IDs must
survive a reload instead of quietly snapping back to a default.

## Ground rules (do not negotiate these)

1. Every UI action goes through the `computerUse` subagent, driving a real VS Code window on
   `DISPLAY=:1`. Real clicks, real typing into the search boxes.
2. Banned as substitutes: Playwright / `bun run e2e`, the mock API server at `localhost:7777`,
   `page.evaluate`, direct gRPC calls, and writing a model id into `providers.json` by hand.
   Reading those files to *verify* is required.
3. Real network, real keys, real models.
4. PASS requires seeing it on screen **and** on-disk corroboration. Statuses: PASS / FAIL /
   BLOCKED / SKIPPED. Never write "should work".
5. Do not edit product code. Record bugs and keep going.
6. Record video of at least one live-fetch picker populating + searching, and one custom-model-id
   round-trip through a reload.

## Environment setup

```bash
cd /workspace/apps/vscode
bun run build:webview && bun esbuild.mjs

export LANE=/tmp/cline-qa/p5
mkdir -p $LANE/clinedir $LANE/userdata $LANE/workspace
printf '# QA workspace\n' > $LANE/workspace/README.md
```

```bash
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-p5 -c /workspace -- bash -l
tmux -f /exec-daemon/tmux.portal.conf send-keys -t vscode-p5:0.0 \
  'DISPLAY=:1 CLINE_DIR=/tmp/cline-qa/p5/clinedir \
   code --no-sandbox --disable-gpu --disable-workspace-trust \
   --user-data-dir=/tmp/cline-qa/p5/userdata --extensions-dir=/tmp/cline-qa/p5/userdata/exts \
   --extensionDevelopmentPath=/workspace/apps/vscode /tmp/cline-qa/p5/workspace 2>&1 | tee -a /tmp/cline-qa/p5/vscode.log' C-m
```

For Ollama, start a local server and pull at least two models first so the "populates" assertion
means something:

```bash
curl -fsSL https://ollama.com/install.sh | sh   # if not already installed
ollama serve &                                   # default http://localhost:11434
ollama pull qwen2.5-coder:1.5b && ollama pull llama3.2:1b
```

For LiteLLM, run a proxy locally (`pip install 'litellm[proxy]'`, then
`litellm --model openai/gpt-4o-mini --port 4000` with `OPENAI_API_KEY` set) so you have a real
`/v1/models` endpoint to point the UI at. If you cannot stand one up, mark LiteLLM BLOCKED and say
why — do not substitute a fake JSON server and call it a pass.

## Pickers to cover

| Provider | Picker | What makes it interesting |
|----------|--------|---------------------------|
| `openrouter` | live catalog + fuzzy search | Hundreds of entries; search performance and correctness |
| `requesty` | live catalog + search | Same shape, different backend |
| `litellm` | live `/v1/models` from a user-supplied base URL + manual refresh | Depends on a URL the user typed |
| `ollama` | polled from the local daemon every ~2 s | Must appear/disappear as models are pulled/removed |
| `openai` (OpenAI-compatible) | `GET {baseUrl}/models` + free-text **Custom Model ID** | The main free-text path |
| `cline` | recommended / free tabs | Tabbed catalog |
| `anthropic` | static catalog dropdown | Control case |

## Test cases

Run D1–D8 for each picker where applicable.

### D1 — Populates

Select the provider, enter its credential/base URL, open the model picker.

Expected: a real list appears within a few seconds, with more than a handful of entries for the
gateways. Record how long it took. A permanently empty list, a spinner that never resolves, or a
list containing only a hardcoded default is a **FAIL**.

### D2 — Search / filter

Type a substring that should match several models (e.g. `sonnet`, `qwen`, `mini`), then a
substring that should match none (e.g. `zzzznotamodel`).

Expected: the list narrows to relevant entries, matching is fuzzy/substring rather than
prefix-only, and a no-match query shows an empty state or a "use custom id" affordance rather than
the unfiltered list or a blank panel.

### D3 — Keyboard

Navigate the filtered list with arrow keys and select with Enter; dismiss with Escape.

Expected: keyboard selection commits the same model that clicking would, and Escape leaves the
previous selection untouched (not cleared).

### D4 — Selection commits

Pick a model, close the picker.

Expected: the chat input's model chip and `providers.json`
(`providers.<id>.settings.model`) both show the chosen id, exactly — no normalization surprises
like a dropped `:free` suffix or a stripped vendor prefix.

### D5 — Refresh

Where there is a refresh control, click it. For Ollama, `ollama pull` a third model while the
picker is open, and `ollama rm` one.

Expected: the list updates without a reload; nothing resets the current selection as a side effect
of refreshing.

### D6 — Custom / free-text model ID sticks

Enter a model id by hand rather than picking from the list. Use a real id that works
(so you can send a message) and, separately, a syntactically odd one (`my-org/my-model:v2`).

Expected: the typed id is accepted, appears in the chip, sends a real message where the id is
valid, and — the part that matters — **is still there after Developer: Reload Window and after a
full VS Code restart**. Reverting to a catalog default is a FAIL.

### D7 — Custom ID vs. list interaction

After setting a custom id, open the picker again and close it without choosing anything. Then
choose a listed model, then re-enter the custom id.

Expected: merely opening the picker does not overwrite the custom id, and switching back and forth
lands on exactly what you selected last.

### D8 — Failure modes are visible

Break the source of the list: wrong API key for the gateway, bogus base URL for LiteLLM/OpenAI-
compatible, stop the Ollama daemon.

Expected: a readable message ("couldn't load models", with the reason), the previously selected
model preserved, and no raw stack trace or infinite spinner. Then restore the source and confirm
the list recovers without a reload.

## Report format

A matrix of `picker × D1–D8`, with the observed populate latency and approximate entry count for
each live picker. For every FAIL: screenshots of the picker in the bad state, the exact query
typed, the on-disk model value, and the Cline output-channel excerpt. Note separately any picker
where a custom model ID did not survive a reload, since that is the highest-severity item here.
