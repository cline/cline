# QA prompt 6 — Token and cost accounting per provider

You are doing **manual QA on the Cline VS Code extension**. Your job: check that the numbers Cline
shows a user are true. Not $0.00 when money was spent, not an absurd number, and cache read/write
tokens present for providers that support prompt caching.

## Ground rules (do not negotiate these)

1. Every UI action goes through the `computerUse` subagent, driving a real VS Code window on
   `DISPLAY=:1`. Real clicks.
2. Banned as substitutes: Playwright / `bun run e2e`, the mock API server at `localhost:7777`,
   `page.evaluate`, direct gRPC calls, and computing what a number "should" be from source instead
   of reading it off the screen.
3. Real network, real keys, real models — a mocked usage payload proves nothing here.
4. PASS requires the on-screen number **and** an independent cross-check (provider dashboard,
   credit-balance delta, or the raw usage recorded on disk). Statuses: PASS / FAIL / BLOCKED /
   SKIPPED. Never write "should work".
5. Do not edit product code. Record bugs and keep going.
6. Record video of one task where you show the task header, expand Token Usage, and then show the
   history row for the same task.

## Environment setup

```bash
cd /workspace/apps/vscode
bun run build:webview && bun esbuild.mjs

export LANE=/tmp/cline-qa/p6
mkdir -p $LANE/clinedir $LANE/userdata $LANE/workspace
printf '# QA workspace\n' > $LANE/workspace/README.md
```

```bash
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-p6 -c /workspace -- bash -l
tmux -f /exec-daemon/tmux.portal.conf send-keys -t vscode-p6:0.0 \
  'DISPLAY=:1 CLINE_DIR=/tmp/cline-qa/p6/clinedir \
   code --no-sandbox --disable-gpu --disable-workspace-trust \
   --user-data-dir=/tmp/cline-qa/p6/userdata --extensions-dir=/tmp/cline-qa/p6/userdata/exts \
   --extensionDevelopmentPath=/workspace/apps/vscode /tmp/cline-qa/p6/workspace 2>&1 | tee -a /tmp/cline-qa/p6/vscode.log' C-m
```

## Where the numbers appear

Check all of these; they are computed by different code paths and can disagree.

| Surface | What it shows |
|---------|---------------|
| Task header, collapsed | cumulative task cost badge (`id="price-tag"`) |
| Task header, expanded → **Token Usage** | Prompt (↑), Completion (↓), Cache Writes (←), Cache Reads (→) |
| Context window bar | last request's total tokens vs. the model's context window |
| History view row | `Tokens: ↑ ↓ → ←` and `$` total for the whole task |
| On disk | the session record — cumulative in `<id>.json`, per-message in `<id>.messages.json` |

Per-request rows in the chat stream do **not** currently render tokens or cost — do not report
that as a bug, but do report if the numbers only exist in one surface and not the others.

Pull the raw recorded numbers (these commands are verified against this environment):

```bash
LANE=/tmp/cline-qa/p6

# cumulative per task
for f in $LANE/clinedir/data/sessions/*/*.json; do
  case "$f" in *.messages.json) continue;; esac
  jq -c '{provider, model, usage: .metadata.usage,
          shown: {tokensIn: .metadata.tokensIn, tokensOut: .metadata.tokensOut,
                  cacheReads: .metadata.cacheReads, cacheWrites: .metadata.cacheWrites,
                  cost: .metadata.totalCost}}' "$f"
done

# per assistant message
jq '.messages[] | select(.role=="assistant") | {modelInfo, metrics}' \
  $LANE/clinedir/data/sessions/<id>/<id>.messages.json
```

Mind the two different "input tokens": `metadata.usage.inputTokens` is the **full** prompt,
while `metadata.tokensIn` is the uncached remainder (`inputTokens − cacheReads − cacheWrites`) and
is what the webview shows. Comparing the wrong pair will make a correct system look broken. A real
record from this environment, for calibration — one short turn on `openai/gpt-4o-mini` via
OpenRouter:

```json
{"inputTokens":2409,"outputTokens":7,"cacheReadTokens":2304,"cacheWriteTokens":0,
 "totalCost":0.00019275}
```

## Independent cross-checks (pick one per provider)

- **OpenRouter**: read the credit balance before and after a task
  (`curl -s https://openrouter.ai/api/v1/credits -H "Authorization: Bearer $OPENROUTER_API_KEY"`),
  and compare the delta to the cost Cline displayed. Also check the Activity page.
- **Cline**: account credit balance in the Cline account view before/after.
- **Anthropic / OpenAI / Google**: the provider console's usage page for that key, for that minute.
- **Local (Ollama/LM Studio)**: nothing to cross-check; the assertion is that cost is $0 or hidden
  and token counts are still present and plausible.

If you have no cross-check available for a provider, say so and downgrade that row to
"displayed value plausible, unverified" rather than PASS.

## Providers to cover

| Provider | Expectation |
|----------|-------------|
| `anthropic` | Non-zero cost computed from catalog pricing; cache reads/writes non-zero on the second turn |
| `openrouter` | Non-zero cost **reported by the provider** (not locally computed); cache fields on a caching-capable route |
| `cline` | Non-zero cost, except on a **free** model where cost is deliberately forced to 0 |
| `openai-native` | Non-zero cost; OpenAI reports cached prompt tokens — check they land in Cache Reads |
| `gemini` / `vertex` | Non-zero cost; cached-content tokens if the model supports it |
| `ollama` / `lmstudio` / `vscode-lm` | Cost badge hidden or $0 **by design**; tokens still counted |
| `openai` (custom OpenAI-compatible) | Cost shown only when you enter both input and output prices in the model info form; verify both states |

## Test cases

### C1 — Single short turn

Send one short message. Compare the displayed prompt/completion tokens against a rough manual
estimate (~4 characters per token for the system prompt + your message).

Expected: same order of magnitude. A prompt-token count of 0, or one that is 100× your estimate, is
a FAIL. Record the exact numbers.

### C2 — Cost is real

Compare the displayed cost with your independent cross-check.

Expected: within a small margin. Explicit FAILs: `$0.0000` on a paid provider that definitely
charged you, a cost that is orders of magnitude off, `NaN`, or a negative number.

### C3 — Cache tokens appear where caching is supported

Send a second and third message in the **same task** (a long first message helps).

Expected: on turns after the first, Cache Reads is non-zero for providers whose selected model
advertises prompt caching, and Cache Writes is non-zero on the turn that populated the cache.
Cross-check against the provider's own reported cached-token count where available. Zero cache
tokens across an entire multi-turn task on a caching model is a FAIL — note the model id, since
this is model-specific.

### C4 — Accumulation

Run a five-turn task, recording the header numbers after each turn.

Expected: cumulative totals are monotonically non-decreasing and the final total equals the sum of
the per-request values recorded on disk. Off-by-one-turn errors and double-counting both show up
here.

### C5 — Surfaces agree

For the same task, compare the task header, the expanded Token Usage panel, and the History row.

Expected: identical numbers. Any disagreement is a FAIL even if each individual number looks
plausible.

### C6 — Deliberate zeroes are deliberate

Run a task on a local provider and on a Cline **free** model.

Expected: $0 / hidden cost, but non-zero token counts, and no "N/A"/"NaN"/blank where a number
belongs. Also confirm a *paid* provider never lands in the hidden-cost path.

### C7 — Custom pricing

On the custom OpenAI-compatible provider, run one task with no prices entered and one with input
and output prices entered.

Expected: no cost shown in the first case; a cost matching your hand calculation
(`tokens ÷ 1e6 × price`) in the second.

### C8 — Big context

Send a task whose prompt is large enough to move the context-window bar meaningfully (paste a long
file).

Expected: the bar and the "last request tokens" value track the real prompt size, and the numbers
stay sane after an auto-compaction (you may see a compaction divider in the chat — record what the
totals do across it).

## Report format

A table of `provider × C1–C8`, and a second table of raw numbers: displayed tokens in/out/cache
read/cache write, displayed cost, cross-check value, and the delta. For every FAIL: screenshots of
the surface showing the wrong number, the raw on-disk usage entry, and the cross-check evidence.
