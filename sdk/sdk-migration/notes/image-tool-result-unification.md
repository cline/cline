# Image-Carrying Tool-Result Unification (PR #259 follow-up)

Status:
- Step 1 (unify shape) — **done** ✅ (tests passing)
- Step 2 (test using real ToolOperationResult shape) — **partially done** — covered at the formatter layer (`ai-sdk-format.test.ts`); agent-runtime layer still uses the clean shape (passes correctly under new code).
- Step 3 (middleware) — pending
- Step 4 (delete fetch interceptor) — pending
- Step 5 (e2e against openai-compatible backend) — pending

Notes after step 1:
- The bug Max called out (point 2: ToolOperationResult `{query,result,success}` wrapper silently passing images through to the wire as JSON) is **fixed by step 1 alone**. `toAiSdkToolResultOutput` now walks the structure, extracts nested image blocks, and emits `{type:'content', value:[text, image-data...]}`. This works on both adapter paths (compat.ts legacy + ai-sdk.ts direct).
- The fetch interceptor in `withToolImageRewriteFetch` is now belt-and-suspenders rather than the primary fix — it sees the same wire shape as before (because `{type:'content'}` serialises to a JSON-stringified content-parts array on Chat Completions), so it remains compatible. Step 3 will replace it with a middleware that operates on the typed message list.
- Mistral is still NOT covered for openai-compatible Chat Completions wire format; the fix needs the middleware (step 3) for that.
- All deleted helpers (`mergeSiblingImagePartsIntoToolResults`, `imageFormatterPartToContentBlock`, `extractImageParts`, `normalizeToolResultValue`) are gone — verified by grep.

Original status: in-progress refactor responding to Max's review of #259.

## Background

PR #259 fixed the symptom (images vanishing when read by `read_files` against
openai-compatible Chat Completions endpoints) by intercepting the outgoing
HTTP body and rewriting it. Max's review identified three structural issues:

1. **Detach-remerge is unnecessary work.** `compat.ts` strips images out of
   tool-results into sibling parts; `mergeSiblingImagePartsIntoToolResults`
   in `ai-sdk-format.ts` puts them back. Two transformations doing the work
   of one.
2. **The SDK-direct path silently loses images** for the actual
   `ToolOperationResult[]` shape that `read_files` produces. The `agent-runtime`
   test passes only because it uses an idealised content-block shape, not the
   real `{query, result, success}` wrapper.
3. **Fetch interceptor is the wrong layer.** Better to use
   `LanguageModelV3Middleware.transformParams` — typed, no body
   parse/stringify, covers Mistral for free, decoupled from the AI SDK's
   wire-output shape.

## Insight

Points 2 and 3 are the same root cause: tool-result `output` is allowed to
take multiple shapes (`string`, content-block array, `ToolOperationResult[]`,
arbitrary JSON), and the lower layers each have to re-discover the shape.

**Fix order: 1 (point 3) → 2 (point 2) → 3 (point 4).** Once tool-result
outputs are normalised to a single content-block array shape upstream, the
direct-path bug disappears and the wire-format middleware becomes a clean
single-shape transformer.

## Plan

### Step 1 — Unify tool-output shape (this commit)

Add a shared flattener:

```ts
// packages/shared/src/llms/tool-output.ts
/**
 * Normalise an arbitrary tool-result `output` into the AI-SDK content-block
 * array shape `[{type:'text',text:string} | {type:'image',data:string,mediaType:string}]`.
 *
 * Recognised input shapes:
 *   - `string`                                        → [{type:'text', text}]
 *   - `null` / `undefined`                            → [{type:'text', text:''}]
 *   - `[{type:'text'},{type:'image'}, ...]`           → returned as-is
 *   - `[{query, result, success, error?, ...}, ...]`  (ToolOperationResult[])
 *       Recursively flattens each entry's `result` and prefixes each
 *       block with a JSON header summarising query/success/error.
 *   - Any other JSON → [{type:'text', text: JSON.stringify(value)}]
 */
export function flattenToolOutput(output: unknown): AiSdkContentBlock[];
```

Use it in:

- `packages/llms/src/providers/compat.ts` — replace the existing
  `extractImageParts` + sibling-emission branch in the `tool_result` case
  with a single call: `output = flattenToolOutput(part.content)`.
  No more sibling user messages.
- `packages/llms/src/providers/ai-sdk.ts::toAiSdkMessages` — in the
  `tool-result` branch, wrap with `flattenToolOutput(part.output)` before
  pushing.
- (Optional but cleaner) Add to the agent-runtime so `tool-result.output`
  is normalised before it's emitted, but this is not strictly necessary —
  doing it in the two adapter paths above is sufficient.

Delete:

- `mergeSiblingImagePartsIntoToolResults` in `ai-sdk-format.ts` and its
  call site at the top of `formatMessagesForAiSdk`. No longer needed
  since nothing produces sibling image parts adjacent to tool messages.
- The `tryParseAISDKToolContent` helper's defensive parsing won't change
  yet; that's step 3.

Keep `toAiSdkToolResultOutput` as-is — its `isAiSdkContentBlockArray`
branch is now exercised on every tool-result, returning `{type:'content',
value:[...]}`. The `json` branch becomes unreachable for tool-results
that came through `flattenToolOutput`.

### Step 2 — Fix the misleading test

Update `packages/agents/src/agent-runtime.test.ts` "preserves image bytes"
test to use the actual `ToolOperationResult` shape:

```ts
{
  output: [{
    query: '/tmp/image.jpg',
    result: [
      { type: 'text', text: 'Successfully read image' },
      { type: 'image', data: 'BASE64DATA', mediaType: 'image/jpeg' },
    ],
    success: true,
  }],
}
```

This should fail without step 1 and pass with it. Add a unit test for
`flattenToolOutput` covering: string, content-block array, single
ToolOperationResult, multi-file ToolOperationResult, error case.

### Step 3 — Replace fetch interceptor with middleware

Add `splitToolImagesMiddleware: LanguageModelV3Middleware` with a
`transformParams` hook that:

- Walks `params.prompt` (typed `LanguageModelV3Message[]`)
- For each `role:'tool'` message whose content is a `ToolResultOutput`
  of `{type:'content', value:[...]}` containing image parts:
  - Replaces the original tool message with a text-only one (image
    parts substituted by `(see following user message for image)`)
  - Appends a synthetic `role:'user'` message containing the image
    parts as `LanguageModelV3FilePart` (mediaType+data)
- Leaves all other messages untouched

Wrap the openai-compatible model factory result with
`wrapLanguageModel({ model, middleware })`. Same for Mistral.

Delete `packages/llms/src/providers/vendors/openai-compatible-image-rewrite.ts`
and its wiring in the openai-compatible vendor factory.

### Step 4 — End-to-end verification

Run clite against:

- An Anthropic-format backend (must still work — was working before)
- An openai-compatible backend (e.g. local llama.cpp or a Mistral key)
  reading 2 images. This was the gap not covered by the previous
  e2e — confirms point 2 is actually fixed.

## Files touched

- NEW: `packages/shared/src/llms/tool-output.ts`
- NEW: `packages/shared/src/llms/tool-output.test.ts`
- MOD: `packages/shared/src/llms/ai-sdk-format.ts` (delete merge, simplify)
- MOD: `packages/shared/src/llms/ai-sdk-format.test.ts` (drop merge tests, keep content-block tests)
- MOD: `packages/llms/src/providers/compat.ts` (delete extractImageParts, use flattenToolOutput)
- MOD: `packages/llms/src/providers/compat.test.ts`
- MOD: `packages/llms/src/providers/ai-sdk.ts` (use flattenToolOutput in toAiSdkMessages)
- MOD: `packages/agents/src/agent-runtime.test.ts` (use real ToolOperationResult shape)
- (Step 3) NEW: `packages/llms/src/providers/middleware/split-tool-images.ts`
- (Step 3) DEL: `packages/llms/src/providers/vendors/openai-compatible-image-rewrite.ts`

## Open questions for follow-up

- **Middleware coverage audit:** confirm every Chat Completions provider
  goes through `wrapLanguageModel` so `transformParams` actually runs.
  Deferred per user.
- **Mistral wire format:** verify it really is openai-compatible chat
  completions and uses the same `output.type === 'content'` JSON-stringification.

## Step 3 — completion notes

Implemented `splitToolImagesMiddleware` as
`LanguageModelV3Middleware.transformParams`, plus 13 unit tests covering:

- pass-through for prompts without tool messages
- pass-through for text-only tool messages (no `mutated` flag set)
- single image-data part split into placeholder + sibling user file part
- file-data with filename + providerOptions preserved across the split
- image-url converted to file part with `image/*` mediaType
- image-file-id (OpenAI-specific) left in place — no FilePart equivalent
- multiple images aggregated from multiple tool-results in one tool message
- multiple separate tool messages each get their own sibling user message
- input prompt array is not mutated (all rewrites are immutable)
- middleware identity preserved when no rewrite is needed (no clone)
- transformed params preserve sibling call-options (temperature, etc.)
- middleware reports `specificationVersion: 'v3'`

Wired `wrapLanguageModel({ model, middleware: splitToolImagesMiddleware })`
into the openai-compatible and mistral vendor factories. Deleted the
fetch interceptor `openai-compatible-image-rewrite.ts`.

Test impact:

- `packages/llms/src/providers/middleware/split-tool-images.test.ts`:
  13/13 pass
- `packages/llms/src/providers/gateway.test.ts`: needed an additive
  update — the test mocks `ai` to expose only `streamText`, and now also
  exposes `wrapLanguageModel` as an identity pass-through so the spy
  models keep flowing through unchanged. All 47 pre-existing tests
  remain green; no behaviour assertions changed.
- Full `packages/llms` suite: 120 pass / 3 live-skipped.
- Full `packages/shared` suite: 109 pass.
- Full `packages/agents` suite: 22 pass.
- `tsc --noEmit` clean across all packages.

Added `@ai-sdk/provider@^3.0.8` as a direct dep of `@clinebot/llms` so
the middleware can import its V3 message types without going through
the `ai` umbrella package (which only re-exports the V2 aliases).

## Coverage

The middleware is wired at exactly two dispatch points:

1. `createOpenAICompatibleProviderModule` in
   `vendors/openai-compatible.ts` — the single factory that all
   providers with `family: "openai-compatible"` route through (per
   `builtins-runtime.ts` family dispatch). This means the middleware
   automatically applies to every provider whose `BUILTIN_SPECS` entry
   has `family: "openai-compatible"` and is NOT overridden to a
   different runtime family. As of this commit that set is:

   - `cline`, `deepseek`, `xai`, `together`, `fireworks`, `groq`,
     `cerebras`, `sambanova`, `nebius`, `baseten`, `requesty`,
     `huggingface`, `vercel-ai-gateway`, `aihubmix`, `hicap`,
     `nousResearch`, `huawei-cloud-maas`, `qwen`, `qwen-code`,
     `doubao`, `zai`, `zai-coding-plan`, `moonshot`, `wandb`,
     `openrouter`, `ollama`, `lmstudio`, `oca`, `asksage`, `sapaicore`

   The `client` discriminator on `BUILTIN_SPECS` (e.g. `"fetch"`,
   `"ai-sdk-community"`) is informational — it does NOT affect runtime
   family dispatch, so providers like `asksage` and `sapaicore` still
   use the AI SDK openai-compatible vendor and inherit the middleware.

2. `createMistralProviderModule` in `vendors/mistral.ts` — Mistral has
   its own non-openai-compatible chat-messages converter but the same
   string-only `role:"tool"` constraint, so the wrapper is applied
   explicitly there.

Providers with `protocol: "openai-responses"` (`litellm`, `v0`,
`xiaomi`, `kilo`) are remapped by `resolveRuntimeFamily` to the
`"openai"` family and use `@ai-sdk/openai`'s Responses API, which
supports multimodal tool inputs natively; they correctly do not get
the middleware. Anthropic-family providers (`anthropic`, `minimax`)
render content arrays on tool messages natively. The remaining
families (`google`, `vertex`, `bedrock`, `claude-code`,
`openai-codex`, `opencode`, `dify`) either support multimodal tool
results natively or are out of scope for image-bearing tool results.

## Deferred

- **Step 4 e2e**: openai-compatible backend image read flow against
  Mistral. Will be verified when the SDK gateway has a smoke harness
  for image inputs against a non-Anthropic provider; classic-Cline
  parity with Mistral was confirmed by the existing fetch-interceptor
  live tests before the rewrite, and the middleware produces the same
  wire shape (placeholder + sibling user message) that those tests
  validated.
