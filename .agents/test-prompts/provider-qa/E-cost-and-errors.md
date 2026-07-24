# Provider QA E — Are the numbers sane and the failures readable?

Two things a user judges Cline by when something goes wrong: whether the cost it reports is believable, and whether
the error it shows tells them what to do.

For cost, three failure modes in descending order of how often they get noticed: **$0.00** for a request that
definitely cost money, **absurd** values (usually a per-token vs. per-million-token units bug), and **missing cache
tokens**, which makes a cached conversation look far more expensive than it was.

For errors, the bar is not "an error appeared". It is that the message says what went wrong and what to do, with no
stack trace, no `[object Object]`, no bare status code — and no silent hang, because a request that will never
succeed must fail visibly and reasonably fast.

Report using the template at the bottom. Record video.

## Your credentials

Save this as `/tmp/qa-keys.json`. The error half of this run is largely doable with nothing filled in; the cost half
needs real keys, since the whole point is comparing against real published prices.

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

```bash
cd /workspace
node .agents/test-prompts/provider-qa/fixtures/apply-keys.mjs --keys /tmp/qa-keys.json --list

export SMOKE=/tmp/cline-qa/smoke
rm -rf "$SMOKE" && node .agents/test-prompts/provider-qa/fixtures/apply-keys.mjs \
  --keys /tmp/qa-keys.json --dir "$SMOKE/data" --select anthropic
CLINE_DATA_DIR="$SMOKE/data" bun run cli "Reply with exactly PONG."
```

## Environment

```bash
export QA=/tmp/cline-qa/cost-errors
rm -rf "$QA" && mkdir -p "$QA/workspace"
cd /workspace/apps/vscode && bun run build:webview && bun esbuild.mjs   # only if dist/extension.js is stale

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s fault-proxy -- \
  node /workspace/.agents/test-prompts/provider-qa/fixtures/fault-proxy.mjs

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-qa -- \
  env DISPLAY=:1 CLINE_DATA_DIR="$QA/data" \
  code --no-sandbox --disable-workspace-trust --user-data-dir="$QA/vscode-userdata" \
       --extensionDevelopmentPath=/workspace/apps/vscode "$QA/workspace"
```

Operational rules, learned the hard way:

- **One VS Code instance at a time.** A second `code` with the same `--user-data-dir` attaches to the first.
  Check `ps -eo pid,args | grep [e]xtensionDevelopmentPath`.
- **Never `kill -9` VS Code.** It poisons the profile and later launches die with *"The window terminated
  unexpectedly (reason: 'crashed', code: '133')"*. Use `kill -TERM`. On crash 133, kill, `rm -rf
  "$QA/vscode-userdata"`, relaunch. If a plain `code` with no `--extensionDevelopmentPath` also crashes, the
  display is degraded — report it as an environment failure, not a Cline bug.

Reaching the settings: Cline icon in the Activity Bar → onboarding (**Bring my own API key** → **Continue**) on an
empty data directory, otherwise the gear icon in the Cline navbar; **Done** closes it. Configure **OpenAI
Compatible** against `http://127.0.0.1:8788/v1` with any non-empty key.

Note that the Model ID field is an autocomplete and commits longer prefix matches — typing `fault/ok` leaves you on
`fault/ok-no-cache`. Since this whole run selects behaviour by model id, read back the committed value every single
time.

## Part 1 — Cost arithmetic, no credentials needed

The fault proxy returns fixed usage numbers, so the expected cost is computable by hand.

| Model | Usage returned | What to check |
|-------|----------------|---------------|
| `fault/ok` | 4213 in / 118 out, 3072 cache read, 1024 cache write | Cache read and write both appear, and input tokens are not double-counted with cached ones |
| `fault/ok-no-cache` | 4213 in / 118 out, no cache fields | No phantom cache numbers appear |
| `fault/big-usage` | 1.2M in / 90k out | Formats sanely, and cost scales linearly against `fault/ok` |
| `fault/zero-usage` | all zeros | Shows zero honestly rather than hiding the row or showing NaN |
| `fault/no-usage` | usage block absent | Degrades gracefully — no NaN, no `undefined`, no crash |

Comparing `fault/ok` against `fault/big-usage` is the quickest units check available: the token ratio is known, so
the cost ratio tells you immediately whether the maths is right.

A dry run of `fault/ok` showed the task header rendering `$0.0000` alongside `4.3k` tokens and a `128.0k` context
window. The zero is expected there — a synthetic model id carries no pricing — but it makes the point that
`$0.0000` on its own tells you nothing. When you see it on a real model, first check whether the model info panel
has prices for that model at all; a missing catalog price and a broken cost calculation look identical in the UI
and need different fixes.

## Part 2 — Cost against real providers

Prioritise `anthropic`, `openai-native`, `openrouter`, `gemini`, `bedrock`, `deepseek`, `groq`, `cline`. Per
provider:

1. Note the model's published input/output price from the model info panel in Settings.
2. Send one substantial message — a few hundred tokens in, a paragraph out.
3. Read cost from the task header; expand it for tokens in, tokens out, cache read and cache write.
4. Check by hand: `in × input_price + out × output_price`, adjusted for cache pricing. Being out by 10×, 1000× or
   1,000,000× is the units bug.
5. Send four more turns; the header total must accumulate rather than reset or replace.
6. Open the history view; that task's total must match the header.
7. Reload the window, reopen the task; totals unchanged.

**Prompt caching.** For `anthropic`, `bedrock` with prompt cache enabled, `openrouter` on a cache-capable model,
and `gemini`: send a long first message (paste a large file), then a short follow-up. The second turn should show a
non-zero cache read and a correspondingly lower cost; the first should show cache writes. If cache columns are
always zero for a provider that documents caching, check whether the model info panel claims `supportsPromptCache`
for that model — the two should agree.

**Deliberately hidden cost.** Subscription providers should show no dollar figure rather than a misleading $0.00.
`openai-codex` is the main one, `cline-pass` may behave similarly. The UI must distinguish "this plan has no
per-request cost" from "we could not compute a cost".

**Cross-check.** For at least one provider, note account usage before and after five requests and compare the
provider's own reported spend to Cline's. A consistent multiplier between the two is the clearest possible evidence
of a units bug.

Failures: $0.00 on a paid model with non-zero tokens; a cost that does not match the published price within
rounding; zero tokens when a reply clearly arrived; cache columns absent for a cache-capable provider; totals that
reset on reload or disagree between header and history; any `NaN`, `undefined`, `-0` or `$0.0000000001`; the
context-window meter disagreeing with reported input tokens.

## Part 3 — Errors, deterministically

Switch the model id to trigger each fault. Same UI state every time, which is what makes results comparable, and it
costs nothing.

| Model | Server response | What the UI must do |
|-------|-----------------|---------------------|
| `fault/401` | 401 `invalid_api_key` | Say the key is wrong and point at where to fix it; must not look like a network problem |
| `fault/402` | 402 `insufficient_credits` | Say credits are exhausted, with a way to top up; should classify as `Balance` |
| `fault/429` | 429 + `Retry-After: 20` | Say it is rate limited, ideally surfacing the retry window; must not hammer the endpoint |
| `fault/context-overflow` | 400 `context_length_exceeded` | Say the conversation is too long and offer a way forward; no raw provider JSON |
| `fault/500` | 500 with an HTML body | Must not render HTML into the chat or print `[object Object]` |
| `fault/hang` | never responds | Must time out with a message; record how long it took |
| `fault/truncated-stream` | stream cut mid-token | Keep the partial text and report the truncation, not silently treat it as complete |
| `fault/slow-stream` | one token every 3s | Cancel mid-stream; the session must stay usable |

After each failure, switch back to `fault/ok` and retry — the error must clear and the conversation continue,
without needing a new task. Watch the request count with `curl -s localhost:8788/__requests`; a retry storm against
a rate-limited endpoint is a serious finding.

### Baseline already observed

A dry run of the 401, 429 and context-overflow cases established this, so you are looking for deviations rather
than starting cold. All three rendered the provider's message verbatim as red text, with no stack trace and no raw
JSON — the 401 showed exactly *"Incorrect API key provided. You can find your API key at
https://example.invalid/keys."* Retry counts differed correctly by fault: the 429 produced three requests at the
proxy, the 401 and the context overflow one each.

Two things that dry run did not settle, and that you should:

- **No Retry button appeared on any of the three error rows.** Establish whether that is intended — `ErrorRow.tsx`
  and its siblings render different affordances per error type — or whether the generic branch is missing one. A
  401 in particular should offer a route to the settings that caused it.
- **Nothing distinguished the three errors visually.** All fell through to the same plain red text, including the
  cases that have dedicated components (`CreditLimitError.tsx`, `SpendLimitError.tsx`). Check whether `ClineError`
  classified them at all, and if not, whether that is because the classifier keys off provider-specific message
  patterns a generic OpenAI-compatible provider does not produce.

## Part 4 — Errors from real providers

The proxy proves Cline handles a well-formed error. Real providers word theirs differently, and that is exactly
where classification falls through.

**Bad key.** Paste a syntactically valid but wrong key into `anthropic`, `openai-native`, `openrouter`, `gemini`
and `groq`. Each should produce an auth error naming the right provider. Then try a malformed key (`x`) and a key
with a trailing newline — the latter should be trimmed rather than failing mysteriously.

**Rate limit.** Easiest on a free tier: send requests back to back on a free OpenRouter or Gemini model until you
are limited. Capture the message and confirm Cline does not retry aggressively.

**Out of credits.** Needs an exhausted account. Cline's own provider has dedicated UI; if you have a test account
with a spend limit, confirm those components render instead of the generic row.

**Context overflow, both paths.** Caught locally — `gateway.ts` rejects with "Estimated prompt tokens exceed model
context window" before sending; trigger it by attaching a file far larger than the window. Rejected remotely — get
just past the limit on a small-context model so the request is sent and refused. Both should tell the user the
conversation is too long. Check whether automatic compaction kicks in, and whether the user is told.

**Network failures.** An unroutable host, a host that resets the connection, and a disconnect mid-stream. Three
distinct readable messages.

**Expired OAuth.** For `cline` or `openai-codex`, invalidate the stored token in `providers.json` and send a
message. Expect a re-authentication prompt, not a raw 401.

Failures: any stack trace, `[object Object]`, `undefined`, raw JSON or raw HTML in the chat; an error that does not
identify which provider failed; a 429 or 402 with no next step; a spinner that never resolves; retry after fixing
the problem requiring a new task; retry logic hammering a rate-limited endpoint; an API key leaking into a message
or log.

## Artifacts

- One video walking the full fault-model list, showing each error row in turn. Entirely reproducible with no
  credentials, and the headline artifact for the error half.
- One video of a multi-turn conversation on a real provider with the task header expanded, showing cost
  accumulating and cache reads appearing on the second turn.
- One video of a real provider's auth failure, followed by fixing the key and the same conversation succeeding.
- Screenshots of every error row, labelled with the fault that produced it.

## Report

**Cost:** a table of provider, model, tokens in/out, cache read/write, displayed cost, hand-computed cost, and the
ratio. Flag every ratio that is not approximately 1.

**Errors:** a table of fault, provider, exact message shown, classified correctly, actionable, retry works, time to
fail. For each unreadable error include the screenshot and the raw response from the proxy log or the provider.
