# Provider QA E — Cost accounting and error paths

You are a QA agent. You drive a real VS Code window on `DISPLAY=:1` and report what you observe.

Two things a user judges Cline by when something goes wrong: whether the reported cost is believable, and whether
the error tells them what to do.

For cost, three failures in descending order of how often they get noticed: **$0.00** for a request that cost
money, **absurd** values (usually a per-token vs. per-million-token units bug), and **missing cache tokens**, which
makes a cached conversation look far more expensive than it was.

For errors, the bar is not "an error appeared". It is that the message says what went wrong and what to do, with no
stack trace, no `[object Object]`, no bare status code, and no silent hang.

## Hard rules

Violating any of these invalidates the run.

1. **Launch and stop VS Code only through `qa-env.sh`.** Never type a `code` command. Two instances sharing a
   profile attach to each other and you will test a window you did not configure.
2. **Never `kill -9` VS Code.** Use `qa-env.sh stop`, and `qa-env.sh recover` if it will not die.
3. **Never edit source code, and never "fix" anything.** The errors in this run are deliberate.
4. **Never read a number off the screen and treat it as data.** Screenshot it as evidence, then transcribe it
   carefully and say so. Confirm which model produced it with `qa-env.sh proxy models`, never by memory — an agent
   on a previous run misread a model id as `1autlok` and misreported a token count.
5. **Quote error text character for character.** Paraphrasing an error message destroys the finding.
6. **No bug report without a reproduction.**

Stop and report if `qa-env.sh start` fails twice after a `recover`, or if `qa-env.sh doctor` blames the
environment.

## Credentials

Save exactly this as `/tmp/qa-keys.json`. The error half needs nothing; the cost half needs real keys, because the
whole point is comparing against real published prices. Leave the `openai-compatible` entry as it is.

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

## Preflight

```bash
export QA=/workspace/.agents/test-prompts/provider-qa/fixtures
cd /workspace

bash $QA/qa-env.sh doctor
bash $QA/qa-env.sh proxy start
node $QA/apply-keys.mjs --keys /tmp/qa-keys.json --list
bash $QA/qa-env.sh start costerr --keys /tmp/qa-keys.json --select openai-compatible
bash $QA/qa-env.sh status          # exactly ONE instance
```

Reaching the UI: Cline icon in the Activity Bar → gear icon in the Cline navbar → **Done**. Dismiss any VS Code
welcome/Copilot/theme modal first.

This whole run selects behaviour by **model id**, and the Model ID field is an autocomplete that commits longer
prefix matches — typing `fault/ok` can leave you on `fault/ok-no-cache`. After every model change, confirm with
`bash $QA/qa-env.sh state costerr`, and after every message confirm what actually went out with
`bash $QA/qa-env.sh proxy models`. Do not trust the field.

---

## Case group E1 — Cost arithmetic, no credentials needed

The mock returns fixed usage, so the expected cost is computable by hand. Case ids as given.

| id | Model | Usage returned | What to check |
|----|-------|----------------|---------------|
| `E1-cache` | `fault/ok` | 4213 in / 118 out, 3072 cache read, 1024 cache write | cache read and write both appear; input tokens not double-counted with cached ones |
| `E1-nocache` | `fault/ok-no-cache` | 4213 in / 118 out, no cache fields | no phantom cache numbers |
| `E1-big` | `fault/big-usage` | 1.2M in / 90k out | formats sanely, and cost scales linearly against `E1-cache` |
| `E1-zero` | `fault/zero-usage` | all zeros | shows zero honestly, not a hidden row and not NaN |
| `E1-none` | `fault/no-usage` | usage block absent | degrades gracefully — no NaN, no `undefined`, no crash |

Comparing `E1-cache` against `E1-big` is the fastest units check available: the token ratio is known, so the cost
ratio tells you immediately whether the maths is right.

Context for `E1-cache`: a previous run saw the task header render `$0.0000` alongside `4.3k` tokens and a `128.0k`
context window. The zero is expected there, because a synthetic model id carries no pricing — which is exactly why
`$0.0000` on its own tells you nothing. When you see it on a real model in E2, first check whether the model info
panel has prices for that model at all: a missing catalog price and a broken cost calculation look identical in the
UI and need different fixes.

---

## Case group E2 — Cost against real providers

One case per provider you have a usable key for: `E2-<provider>`. Prioritise `anthropic`, `openai-native`,
`openrouter`, `gemini`, `bedrock`, `deepseek`, `groq`, `cline`.

**Steps**

1. Note the model's published input/output price from the model info panel in Settings. Screenshot it.
2. Send one substantial message — a few hundred tokens in, a paragraph out.
3. Read cost from the task header; expand it for tokens in, tokens out, cache read, cache write. Screenshot.
4. Compute by hand: `in × input_price + out × output_price`, adjusted for cache pricing.
5. Send four more turns; the header total must accumulate rather than reset or replace.
6. Open the history view; that task's total must match the header.
7. Reload the window, reopen the task; totals unchanged.

**PASS IF** the displayed cost is within rounding of your computed cost, tokens are non-zero, totals accumulate,
and history agrees with the header.
**FAIL IF** the ratio of displayed to computed is 10×, 1000× or 1,000,000× (the units bug); or $0.00 on a paid
model with non-zero tokens; or zero tokens when a reply clearly arrived; or totals reset on reload; or any `NaN`,
`undefined`, `-0` or `$0.0000000001` is rendered; or the context-window meter disagrees with reported input tokens.

`E2-cache-<provider>` — for `anthropic`, `bedrock` with prompt cache enabled, `openrouter` on a cache-capable
model, and `gemini`: send a long first message (paste a large file), then a short follow-up. The second turn should
show a non-zero cache read and a lower cost; the first should show cache writes. If cache columns are always zero
for a provider that documents caching, check whether the model info panel claims `supportsPromptCache` for that
model — the two should agree.

`E2-hidden` — subscription providers should show no dollar figure rather than a misleading $0.00. `openai-codex` is
the main one; `cline-pass` may behave similarly. The UI must distinguish "this plan has no per-request cost" from
"we could not compute a cost".

`E2-crosscheck` — for at least one provider, note account usage before and after five requests and compare the
provider's own reported spend to Cline's. A consistent multiplier is the clearest possible evidence of a units bug.

---

## Case group E3 — Errors, deterministically

Switch the model id to trigger each fault. Same UI state every time, which is what makes the results comparable,
and it costs nothing. Confirm the model with `state` before sending and with `proxy models` after.

| id | Model | Server response | What the UI must do |
|----|-------|-----------------|---------------------|
| `E3-401` | `fault/401` | 401 `invalid_api_key` | say the key is wrong and point at where to fix it; must not look like a network problem |
| `E3-402` | `fault/402` | 402 `insufficient_credits` | say credits are exhausted, with a way to top up; should classify as `Balance` |
| `E3-429` | `fault/429` | 429 + `Retry-After: 20` | say it is rate limited, ideally surfacing the retry window |
| `E3-context` | `fault/context-overflow` | 400 `context_length_exceeded` | say the conversation is too long and offer a way forward; no raw provider JSON |
| `E3-500` | `fault/500` | 500 with an HTML body | must not render HTML into the chat or print `[object Object]` |
| `E3-hang` | `fault/hang` | never responds | must time out with a message; record how long it took |
| `E3-truncated` | `fault/truncated-stream` | stream cut mid-token | keep the partial text and report the truncation, not silently treat it as complete |
| `E3-slow` | `fault/slow-stream` | one token every 3s | cancel mid-stream; the session must stay usable |

After each, switch back to `fault/ok` and retry — the error must clear and the conversation continue without
needing a new task. Check retry volume with `bash $QA/qa-env.sh proxy count`; a retry storm against a rate-limited
endpoint is a serious finding.

### Baseline already observed — look for deviations, not first contact

A previous run of `E3-401`, `E3-429` and `E3-context` established: all three rendered the provider's message
verbatim as red text, with no stack trace and no raw JSON. The 401 showed exactly *"Incorrect API key provided. You
can find your API key at https://example.invalid/keys."* Retry counts differed correctly by fault — the 429
produced three requests at the proxy, the 401 and the context overflow one each.

Two things that run did not settle, and that you must:

- **`E3-retry-affordance`** — no Retry button appeared on any of the three error rows. Establish whether that is
  intended (`ErrorRow.tsx` and its siblings render different affordances per error type) or whether the generic
  branch is missing one. A 401 in particular should offer a route to the settings that caused it.
- **`E3-classification`** — nothing distinguished the three errors visually. All fell through to the same plain red
  text, including cases that have dedicated components (`CreditLimitError.tsx`, `SpendLimitError.tsx`). Determine
  whether `ClineError` classified them at all, and if not, whether that is because the classifier keys off
  provider-specific message patterns that a generic OpenAI-compatible provider does not produce.

---

## Case group E4 — Errors from real providers

The mock proves Cline handles a well-formed error. Real providers word theirs differently, and that is where
classification falls through.

| id | What to do |
|----|-----------|
| `E4-badkey-<provider>` | Paste a syntactically valid but wrong key into `anthropic`, `openai-native`, `openrouter`, `gemini`, `groq`. Each must produce an auth error naming the right provider. Then try a malformed key (`x`) and a key with a trailing newline — the latter should be trimmed, not fail mysteriously. |
| `E4-ratelimit` | On a free OpenRouter or Gemini model, send requests back to back until limited. Capture the message; confirm Cline does not retry aggressively. |
| `E4-credits` | Needs an exhausted account. If you have a test account with a spend limit, confirm the dedicated components render instead of the generic row. Otherwise mark `skipped`. |
| `E4-context-local` | Attach a file far larger than the model's window. `gateway.ts` should reject before sending with "Estimated prompt tokens exceed model context window". |
| `E4-context-remote` | Get just past the limit on a small-context model so the request is sent and the provider refuses. Both paths must tell the user the conversation is too long. Note whether automatic compaction kicks in and whether the user is told. |
| `E4-network` | Point a provider at an unroutable host; then at a host that resets the connection; then disconnect mid-stream. Three distinct readable messages. |
| `E4-oauth` | For `cline` or `openai-codex`, invalidate the stored token in `providers.json` and send a message. Expect a re-authentication prompt, not a raw 401. |

**FAIL IF** any stack trace, `[object Object]`, `undefined`, raw JSON or raw HTML reaches the chat; an error does
not identify which provider failed; a 429 or 402 has no next step; a spinner never resolves; retrying after fixing
the problem requires a new task; retry logic hammers a rate-limited endpoint; or an API key appears in a message or
log.

---

## Artifacts

- One video walking the full E3 fault list, showing each error row in turn. Fully reproducible with no credentials,
  and the headline artifact for the error half.
- One video of a multi-turn conversation on a real provider with the task header expanded, showing cost
  accumulating and cache reads appearing on the second turn.
- One video of a real provider's auth failure, then fixing the key and the same conversation succeeding.
- One screenshot per error row, labelled with the fault that produced it.

## Report

Return exactly this JSON, then a short prose summary.

```json
{
  "run": "E",
  "environment": { "doctorClean": true, "notes": "" },
  "credentials": { "usable": [], "unusable": [], "notProvided": [] },
  "cost": [
    { "id": "E2-anthropic", "provider": "anthropic", "model": "",
      "tokensIn": 0, "tokensOut": 0, "cacheRead": 0, "cacheWrite": 0,
      "displayedCost": "", "computedCost": "", "ratio": 1.0,
      "status": "pass|fail|blocked|skipped", "evidence": "", "artifact": "" }
  ],
  "errors": [
    { "id": "E3-401", "modelOnWire": "fault/401", "exactMessage": "",
      "classifiedCorrectly": null, "actionable": null, "retryWorks": null,
      "requestCount": 1, "timeToFailSeconds": 0,
      "status": "pass|fail|blocked|skipped", "evidence": "", "artifact": "" }
  ],
  "findings": [
    { "id": "F1", "severity": "high|medium|low", "summary": "",
      "repro": [], "expected": "", "actual": "", "evidence": "", "suspectedFile": "" }
  ]
}
```

Flag every cost `ratio` that is not approximately 1. `exactMessage` must be character-for-character, and
`modelOnWire` must come from `proxy models`, not from the settings field.
