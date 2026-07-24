# QA 07 — Token and cost accounting is sane per provider

You are testing the numbers Cline shows about what a request cost. Three ways this goes wrong, in descending order
of how often users notice:

- **$0.00** for a request that definitely cost money.
- **Absurd** values — off by orders of magnitude, usually a units bug (per-token vs. per-million-token pricing).
- **Cache tokens missing** for providers that support prompt caching, which makes a cached conversation look far
  more expensive than it was.

Owning code:

- `sdk/packages/llms/src/providers/ai-sdk.ts` and `gateway.ts` — normalise provider usage into `totalCost` and
  cache token counts
- `sdk/packages/core/src/services/usage.ts` — `accumulateUsageTotals`, `summarizeUsageFromMessages`
- `apps/vscode/src/sdk/message-translator.ts` — writes `tokensIn`, `tokensOut`, `cacheWrites`, `cacheReads`, `cost`
  into the `api_req_started` message
- `apps/vscode/src/shared/getApiMetrics.ts` — aggregates them for the UI
- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.tsx`, `ContextWindowSummary.tsx`,
  `RequestStartRow.tsx`, `HistoryViewItem.tsx` — where the numbers are displayed
- `apps/vscode/webview-ui/src/components/settings/common/ModelInfoView.tsx` — the published prices the UI claims
- `useProviderUsageCostDisplay.ts` — the `usage_cost_display` capability that intentionally hides cost for
  subscription providers

## Setup

```bash
export QA=/tmp/cline-qa/cost
rm -rf "$QA" && mkdir -p "$QA/data/settings" "$QA/workspace"

cd /workspace/apps/vscode && bun run build:webview && bun esbuild.mjs

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-cost -- \
  env DISPLAY=:1 CLINE_DATA_DIR="$QA/data" \
  code --no-sandbox --user-data-dir="$QA/vscode-userdata" \
       --extensionDevelopmentPath=/workspace/apps/vscode "$QA/workspace"
```

## Part 1 — Deterministic arithmetic check, no credentials

Before testing real providers, verify the maths against known inputs. The fault proxy returns fixed usage numbers,
so the expected cost is computable by hand.

```bash
node /workspace/.agents/test-prompts/provider-qa/fixtures/fault-proxy.mjs
```

Configure OpenAI Compatible against `http://127.0.0.1:8788/v1` and work through these models:

| Model | Usage returned | What to check |
|-------|----------------|---------------|
| `fault/ok` | 4213 in / 118 out, 3072 cached read, 1024 cache write | Cache read and write both appear in the UI, and the input tokens are not double-counted with the cached ones |
| `fault/ok-no-cache` | 4213 in / 118 out, no cache fields | No phantom cache numbers appear |
| `fault/big-usage` | 1.2M in / 90k out | Displays with sane formatting and the cost scales linearly against `fault/ok` |
| `fault/zero-usage` | all zeros | Shows zero honestly rather than hiding the row or showing NaN |
| `fault/no-usage` | usage block absent | Degrades gracefully — no NaN, no `undefined`, no crash |

Compare `fault/ok` and `fault/big-usage`: the token ratio is known, so the cost ratio tells you immediately whether
the units are right.

## Part 2 — Real providers

For each provider you have a key for — prioritise `anthropic`, `openai-native`, `openrouter`, `gemini`, `bedrock`,
`deepseek`, `groq`, and `cline` — do the following.

1. Note the model's published input/output price from the model info panel in Settings.
2. Send one substantial message (a few hundred tokens of input, asking for a paragraph of output).
3. From the task header, read the cost. Expand it and read tokens in, tokens out, and cache read/write.
4. Check the cost by hand: `in × input_price + out × output_price`, adjusted for cache pricing. It should be within
   rounding distance. Being out by 10×, 1000× or 1,000,000× is the units bug.
5. Send four more turns. The header total must accumulate — not reset, not replace.
6. Open the history view. That task's total must match the header.
7. Reload the window and reopen the task. The totals must be unchanged.

## Part 3 — Prompt caching

Providers that support caching should report cache reads on a *second* turn in the same conversation, once the
prefix is cached. Test `anthropic`, `bedrock` with prompt cache enabled, `openrouter` on a cache-capable model, and
`gemini`.

Send a long first message (paste a large file so the prefix is substantial), then a short follow-up. On the second
turn you expect a non-zero cache read, and a correspondingly *lower* cost than the first turn. Cache writes should
appear on the first turn.

If cache columns are always zero for a provider that documents caching, that is the finding — and check whether the
model info panel claims `supportsPromptCache` for that model, because the two should agree.

## Part 4 — Deliberately-hidden cost

Subscription providers should show no dollar figure rather than a misleading $0.00. `openai-codex` is the main one;
`cline-pass` may behave similarly. Confirm the UI distinguishes "this plan has no per-request cost" from "we could
not compute a cost".

## Part 5 — Cross-check against the provider

For at least one provider, note your account's usage before and after a session of five requests, and compare the
provider's own reported spend to Cline's. A consistent multiplier between the two is the clearest possible evidence
of a units bug.

## What counts as a failure

- $0.00 on a paid model with non-zero tokens.
- A cost that does not match the published price within rounding.
- Tokens in/out of zero when a reply clearly arrived.
- Cache columns absent or always zero for a cache-capable provider.
- Totals that reset on reload, or a history total that disagrees with the header.
- Any `NaN`, `undefined`, `-0`, or `$0.0000000001` rendered to the user.
- The context-window meter disagreeing with the reported input tokens.

## Artifacts

- One video: a multi-turn conversation on a real provider with the task header expanded, showing cost accumulating
  and cache reads appearing on the second turn.
- One screenshot per provider of the expanded token breakdown, with the model info panel's prices visible for
  comparison.
- Your arithmetic, in the report — expected versus displayed for every provider.

## Report

A table of provider, model, tokens in/out, cache read/write, displayed cost, hand-computed cost, and the ratio
between them. Flag every ratio that is not approximately 1.
