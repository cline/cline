# QA 08 — Real error paths produce readable errors

You are testing what a user sees when a provider says no. The bar is not "an error appeared". It is:

- the message says **what went wrong** in the user's terms,
- it says **what to do about it**,
- there is no raw stack trace, no `[object Object]`, no bare HTTP status,
- and there is no silent hang — a request that will never succeed must fail visibly, and reasonably quickly.

Four cases matter most: bad key (401), rate limit (429), out of credits (402), and context overflow.

Owning code:

- `apps/vscode/src/services/error/ClineError.ts` — classification into `Auth`, `RateLimit`, `Balance`,
  `SpendLimit`, `QuotaExceeded`, `Entitlement`
- `apps/vscode/webview-ui/src/components/chat/ErrorRow.tsx` — the main error surface
- `CreditLimitError.tsx`, `SpendLimitError.tsx`, `EntitlementError.tsx`, `ClinePassLimitError.tsx`,
  `OrgClinePassRestrictionError.tsx` — the specialised ones
- `apps/vscode/webview-ui/src/components/chat/RequestStartRow.tsx` — wires `apiRequestFailedMessage` into the row
- `sdk/packages/llms/src/providers/gateway.ts` — where a prompt that exceeds the context window is caught before
  the request goes out

Note that `ClineError` classification keys off status codes *and* message patterns, so an error whose text a
provider words unusually can fall through to the generic branch. That fall-through is a legitimate finding.

## Setup

```bash
export QA=/tmp/cline-qa/errors
rm -rf "$QA" && mkdir -p "$QA/data/settings" "$QA/workspace"

cd /workspace/apps/vscode && bun run build:webview && bun esbuild.mjs

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s fault-proxy -- \
  node /workspace/.agents/test-prompts/provider-qa/fixtures/fault-proxy.mjs

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-errors -- \
  env DISPLAY=:1 CLINE_DATA_DIR="$QA/data" \
  code --no-sandbox --user-data-dir="$QA/vscode-userdata" \
       --extensionDevelopmentPath=/workspace/apps/vscode "$QA/workspace"
```

## Part 1 — Deterministic error injection

Configure OpenAI Compatible against `http://127.0.0.1:8788/v1` with any non-empty key, then switch the model id to
trigger each fault. This gives you every failure on demand, in the exact same UI state, which is what makes the
results comparable — and it costs nothing.

| Model | Server response | What the UI must do |
|-------|-----------------|---------------------|
| `fault/401` | 401 `invalid_api_key` | Say the key is wrong and point at where to fix it. Must not look like a network problem. |
| `fault/402` | 402 `insufficient_credits` | Say credits are exhausted, with a way to top up. Should classify as `Balance`. |
| `fault/429` | 429 `rate_limit_exceeded` + `Retry-After: 20` | Say it is rate limited. Ideally honour or surface the retry window. Must not hammer the endpoint — watch the proxy's request count. |
| `fault/context-overflow` | 400 `context_length_exceeded` | Say the conversation is too long, and offer a way forward. Must not show the raw provider JSON. |
| `fault/500` | 500 with an HTML body | Must not render HTML into the chat or print `[object Object]`. |
| `fault/hang` | never responds | Must time out with a message. Note how long it took. An indefinite spinner is a bug. |
| `fault/truncated-stream` | stream cut mid-token | The partial text should be kept and the truncation reported, not silently treated as a complete reply. |
| `fault/slow-stream` | one token every 3s | Cancel mid-stream and confirm the session is usable afterwards. |

For each: capture the exact on-screen text, confirm there is no stack trace, and confirm a Retry affordance exists
and works. After a failure, fix the config (switch to `fault/ok`) and retry — the error state must clear and the
conversation must continue rather than needing a new task.

Check the proxy's request count around the 429 case specifically:

```bash
curl -s localhost:8788/__requests
```

An automatic retry storm against a rate-limited endpoint is a serious finding.

## Part 2 — Real providers, real errors

The proxy proves Cline handles a well-formed error. Real providers word theirs differently, and that is where
classification falls through. These need real keys.

**Bad key.** Paste a syntactically valid but wrong key into `anthropic`, `openai-native`, `openrouter`, `gemini`
and `groq`. Each should produce an auth error naming the right provider. Then try a *malformed* key (`x`) and a key
with a trailing newline — the latter should be trimmed rather than failing mysteriously.

**Rate limit.** Easiest on a free tier: send several requests back to back on a free OpenRouter or Gemini model
until you are limited. Capture the message. Confirm Cline does not retry aggressively.

**Out of credits.** Requires an exhausted account. Cline's own provider has dedicated UI (`CreditLimitError.tsx`,
`SpendLimitError.tsx`) — if you have access to a test account with a spend limit, confirm those render rather than
the generic row.

**Context overflow.** Two distinct paths, and both need checking:

- *Caught locally* — `gateway.ts` rejects with "Estimated prompt tokens exceed model context window" before
  sending. Trigger it by attaching a file far larger than the model's window.
- *Rejected by the provider* — get just past the limit so the request is sent and the provider refuses. Use a
  small-context model to make this easy.

In both cases the user should learn that the conversation is too long and what to do. Check whether automatic
compaction kicks in, and if it does, whether the user is told.

**Network-level failures.** Point a provider at an unroutable host, then at a host that resets the connection, then
disconnect the network mid-stream. All three should produce distinct, readable messages.

**Expired OAuth.** For `cline` or `openai-codex`, invalidate the stored token in `providers.json` and send a
message. Expect a re-authentication prompt, not a raw 401.

## What counts as a failure

- Any stack trace, `[object Object]`, `undefined`, raw JSON, or raw HTML rendered in the chat.
- An error that does not identify which provider failed.
- A 429 or 402 presented as a generic failure with no next step.
- A spinner that never resolves.
- Retrying after fixing the problem does not work without starting a new task.
- Retry logic that hammers a rate-limited endpoint.
- An error that leaks the API key into the message or the logs.

## Artifacts

- One video walking the full fault-model list, showing each error row in turn — this is the headline artifact and
  is entirely reproducible with no credentials.
- One video of a real provider's auth failure, followed by fixing the key and the same conversation succeeding.
- Screenshots of every error row, labelled with the fault that produced it.

## Report

A table of fault, provider, exact message shown, classified correctly (Y/N), actionable (Y/N), retry works (Y/N),
time to fail. For each unreadable error, include the screenshot and the raw response from the proxy log or the
provider.
