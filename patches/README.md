# AI SDK stream retries (`ai@7.0.120.patch`)

AI SDK 7.0.120 normalizes provider stream errors into `StreamProviderError`,
but its automatic stream retry loop does not consult `isRetryable` or wait
between attempts. The callback retry path also cannot veto automatic retries.

This patch changes the SDK source and distributed runtime at the retry boundary:

- Automatic and callback stream retries require `isRetryable === true`.
  Missing or false retryability is terminal.
- Stream retries wait 2 seconds, then 4, then 8 for Cline's three-retry budget.
  The request abort signal cancels the wait. Request-level `maxRetries` and
  its existing retry-after handling are unchanged.
- Provider-executed tool input/call activity or a provider tool result/error
  blocks replay, including callback-requested replay. Local tools retain the
  SDK's buffering and execute only after the attempt succeeds.

`@cline/llms` pins the patched version. The root Bun patch configuration applies
this fix to repository builds; it is not inherited by external consumers of a
published `@cline/llms` package. Replace this patch with an upstream SDK release
before relying on this policy in independently installed SDK packages.

`ai-sdk.stream-retries.integration.test.ts` exercises the actual SDK retry loop,
including normalized errors, backoff, aborts, provider tools, local tools, and
mocked HTTP responses through the Cline adapter. Langfuse integration tests
verify that failed attempts still export and recovered operations stay successful.
