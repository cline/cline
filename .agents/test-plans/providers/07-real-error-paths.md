# QA prompt 7 — Real error paths

You are doing **manual QA on the Cline VS Code extension**. Your job: deliberately break things
that only break with real credentials — bad key, rate limit, out of credits, context overflow — and
judge what the user sees. The bar is: **a readable message that says what happened and what to do**.
Not a raw stack trace, not a bare HTTP code, not a spinner that never ends.

## Ground rules (do not negotiate these)

1. Every UI action goes through the `computerUse` subagent, driving a real VS Code window on
   `DISPLAY=:1`. Real clicks.
2. Banned as substitutes: Playwright / `bun run e2e`, the mock API server at `localhost:7777`,
   `page.evaluate`, direct gRPC calls, and injecting a fake error into the code to "simulate" a
   failure. Every error in this plan must come from a real provider response — that is the whole
   point of the task.
3. Real network, real keys, real models.
4. PASS requires the on-screen message **and** confirmation of the underlying HTTP status
   (Cline output channel, or your own `curl` of the same endpoint with the same key run separately
   to establish what the provider returns). Statuses: PASS / FAIL / BLOCKED / SKIPPED.
5. Do not edit product code. Record bugs and keep going.
6. Record video for E1 (bad key) and E4 (context overflow) at minimum.

## Environment setup

```bash
cd /workspace/apps/vscode
bun run build:webview && bun esbuild.mjs

export LANE=/tmp/cline-qa/p7
mkdir -p $LANE/clinedir $LANE/userdata $LANE/workspace
printf '# QA workspace\n' > $LANE/workspace/README.md
# a big file for the context-overflow case
python3 -c "print('\n'.join('line %d: the quick brown fox jumps over the lazy dog' % i for i in range(60000)))" > $LANE/workspace/huge.txt
```

```bash
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-p7 -c /workspace -- bash -l
tmux -f /exec-daemon/tmux.portal.conf send-keys -t vscode-p7:0.0 \
  'env -u OPENROUTER_API_KEY -u CLINE_API_KEY -u ANTHROPIC_API_KEY -u OPENAI_API_KEY \
   DISPLAY=:1 CLINE_DIR=/tmp/cline-qa/p7/clinedir \
   code --no-sandbox --disable-gpu --disable-workspace-trust \
   --user-data-dir=/tmp/cline-qa/p7/userdata --extensions-dir=/tmp/cline-qa/p7/userdata/exts \
   --extensionDevelopmentPath=/workspace/apps/vscode /tmp/cline-qa/p7/workspace 2>&1 | tee -a /tmp/cline-qa/p7/vscode.log' C-m
```

**`env -u` is mandatory in this plan.** Keys are resolved as stored key → resolver → environment
variable (`sdk/packages/llms/src/providers/http.ts`). If you clear a key field to test the
"missing key" path while `OPENROUTER_API_KEY` is still in the environment, the request will
succeed and you will record a false PASS. Grab the real key values into your notes before
launching so you can paste them when a case needs a working key.

## What "good" looks like

For every error case, judge these five things and report them individually:

| Criterion | Fail example |
|-----------|--------------|
| **Readable** | "Request failed with status code 401" with no context, or a JS stack trace |
| **Attributed** | The message does not say which provider or model failed |
| **Actionable** | No hint about fixing the key / adding credits / waiting / shortening the context |
| **Recoverable** | No Retry or Start New Task affordance, or Retry does nothing |
| **Safe** | The API key, `Authorization` header, or internal file paths appear in the message |

Also check every time: **no silent hang**. If nothing appears within 60 s, that is a FAIL in its
own right — record how long you waited.

## Test cases

### E1 — Invalid API key (401) — record video

Enter a syntactically plausible but wrong key (e.g. flip the last 6 characters of a real one) for
each provider you can, and send a message.

Expected: a clear "invalid/unauthorized key" message naming the provider, with a Retry affordance.
For the `cline` provider specifically, expect a sign-in prompt rather than a generic error.

Also run the empty-key variant: clear the field entirely and send. Expected: it is blocked or
errors clearly — and, because you launched with `env -u`, it must **not** silently succeed.

### E2 — Rate limit (429)

Provoke a real 429. Reliable options: an OpenRouter `:free` model hit with several requests in
quick succession, or a free-tier Groq/Gemini key. Send messages back to back (or start several
tasks) until the provider throttles you. Confirm the 429 independently with a `curl` loop against
the same endpoint and key.

Expected: a message that identifies this as rate limiting (ideally with the retry-after or request
id if the provider sends one), a Retry affordance, and — importantly — no infinite silent retry
loop burning your quota in the background. Note whether Cline retries automatically, how many
times, and whether the UI tells you it is retrying.

### E3 — Out of credits / payment required (402)

Provision a key that will 402: on OpenRouter, create an API key with a credit limit of `$0` (or
use an exhausted key). Send a message.

Expected: an "out of credits / insufficient balance" message distinct from the 401 message, with a
link or instruction to top up. For the `cline` provider, expect the dedicated credit-limit UI with
the balance shown. A 402 that renders as a generic auth error is a FAIL — users then rotate a
perfectly good key.

### E4 — Context window overflow — record video

Pick a small-context model (a 4k–8k context route on OpenRouter is easiest), then force the prompt
over the limit — `@`-mention `huge.txt`, or paste a large chunk of it.

Expected: either Cline compacts/condenses the context and tells you it did (a compaction notice in
the chat), or it fails with a message that plainly says the context is too long and suggests
starting a new task or condensing. FAIL conditions: a raw provider error string with no
explanation, a hang, or a truncation that silently drops content without saying so. Record which
of the two behaviors you got, per provider — they should not differ arbitrarily.

### E5 — Unreachable endpoint

Set a custom base URL to something that does not resolve, and separately to something that resolves
but refuses connections (e.g. `http://127.0.0.1:9/v1`).

Expected: a network-error message naming the URL, promptly (not after a multi-minute stall), with
Retry. A raw `ECONNREFUSED`/`ENOTFOUND` with no wrapping is a soft FAIL — note it.

### E6 — Model not found (404 / 400)

Enter a custom model id that does not exist on the provider.

Expected: a message saying the model is unknown, ideally naming it. It must not be reported as an
auth failure, and it must not silently fall back to a different model — check the session record
to confirm no substitution happened.

### E7 — Credential revoked mid-task

Start a multi-turn task successfully, then invalidate the key (edit it in Settings) and continue
the conversation.

Expected: the in-flight task fails with the same clear auth error rather than corrupting the task
state, and after restoring the key, Retry resumes normally.

### E8 — Timeout

Set the request timeout very low (e.g. 1 ms in the provider form) and send a message.

Expected: a timeout error quickly, clearly labelled as a timeout, with Retry — not a hang and not a
misreported network error.

### E9 — Error UI hygiene sweep

Across all of the above, collect the exact rendered text of every error.

Expected: no JS stack frames, no `node_modules` paths, no absolute paths from the developer's
machine, no API keys or `Authorization` headers, no unrendered JSON blobs dumped into the chat.
Also confirm the chat is left in a usable state after each error (you can send another message
without restarting the extension).

## Report format

A table of `case × provider` with the five criteria scored (readable / attributed / actionable /
recoverable / safe) plus time-to-error. Paste the **verbatim** error text for each, alongside the
actual HTTP status you confirmed independently. Screenshots for every distinct error UI, and the
videos for E1 and E4. Finish with a ranked list of the worst offenders — the errors most likely to
send a user down the wrong debugging path.
