# Context compaction

This document describes the context compaction subsystem owned by
`@cline/core` under
[`src/extensions/context/`](../src/extensions/context/). It covers the
public config surface, the trigger/budget math, the two built-in
strategies, the persisted compaction sidecar, observability, and how to
test compaction changes.

For the layering rationale (why `core` owns compaction and `agents` only
owns the prepare-turn seam), see
[ARCHITECTURE.md §9](../../../ARCHITECTURE.md#9-context-compaction).

## Overview

Compaction keeps a long-running session inside the model's input budget by
rewriting the *working context* sent to the provider, while the canonical
session transcript (`${sessionId}.messages.json`, see
[messages-contract-v1.md](./messages-contract-v1.md)) stays append-only and
full-fidelity. Compacted state lives in a separate sidecar,
`${sessionId}.compaction.json`.

Two functions in
[`compaction.ts`](../src/extensions/context/compaction.ts) make up the
pipeline:

- `createContextCompactionPrepareTurn(config, options?)` — builds the
  `prepareTurn` callback that decides *whether* and *how much* to compact
  before each provider request, and runs the selected strategy. Returns
  `undefined` unless `config.compaction.enabled === true`.
- `createCompactionStateAwarePrepareTurn({ compact?, getState?, saveState? })`
  — wraps the above with sidecar persistence: it projects previously
  compacted state into the working context, feeds re-compaction from that
  projection, and saves new state after each successful compaction.

`LocalRuntimeHost` wires the state-aware wrapper **unconditionally**, even
when auto-compaction is disabled (`compact` is `undefined`). This is a
behavioral contract: a manual `/compact` persists a sidecar and promises
that subsequent turns use the compacted context, so the projection must
keep running regardless of the auto-compaction setting. With no sidecar and
no `compact` function the wrapper is a no-op.

## Config surface

`CoreSessionConfig.compaction` accepts a `CoreCompactionConfig`
([`types/config.ts`](../src/types/config.ts)):

```ts
compaction: {
  enabled: true,
  strategy: "agentic",              // "agentic" (default) | "basic"
  preserveRecentTokens: 20_000,     // verbatim tail kept out of the summary
  summarizer: {                     // optional dedicated summarizer model
    providerId: "anthropic",
    modelId: "claude-haiku-4-5",
    apiKey: process.env.ANTHROPIC_API_KEY,
    // modelInfo / knownModels let agentic compaction budget against the
    // summarizer's real context window instead of the active model's.
  },
  compact: async (context) => ...,  // custom strategy; overrides built-ins
}
```

Notes:

- `enabled` must be exactly `true`; anything else disables the auto
  pipeline (the sidecar projection still runs, see above).
- When `strategy` is unset the default is **agentic**. An explicit
  `"basic"` is preserved.
- If the agentic strategy throws (for anything other than an abort), the
  pipeline logs a warning and falls back to basic compaction for that run.
  Telemetry reports the strategy that actually executed.
- A custom `compact` function bypasses both built-ins entirely and is
  reported to telemetry as strategy `"custom"`. It gets no automatic
  fallback.
- `summarizer` defaults: the active session's provider config with
  `thinking` disabled and `maxOutputTokens` capped at 1,024
  (`openai-codex` instead drops `maxOutputTokens` entirely). See
  `resolveSummarizerConfig` in
  [`compaction-shared.ts`](../src/extensions/context/compaction-shared.ts).

## Trigger and budget math

All token numbers are heuristic estimates (`estimateTokens` in
`@cline/shared`: `ceil(chars / 3)` over the JSON-serialized message), not
provider-exact counts. Constants live in
[`compaction-shared.ts`](../src/extensions/context/compaction-shared.ts).

Per prepared turn:

1. **Effective input limit.** `maxInputTokens` from model info, clamped to
   the context window. If the model only reports a context window, 90% of
   it is used (`CONTEXT_WINDOW_INPUT_RATIO`). With no model info at all,
   `DEFAULT_MAX_INPUT_TOKENS` (128k) applies.
2. **Trigger.** The full request estimate (system prompt + tool definitions
   + messages, via `estimateRequestInputTokens`) is compared against
   `maxInputTokens * COMPACTION_TRIGGER_RATIO` (0.9). In `auto` mode,
   below the trigger the turn is left untouched. `manual` mode always
   compacts.
3. **Target.** In auto mode the strategy compacts toward
   `triggerTokens * DEFAULT_TARGET_RATIO` (0.7). Long conversations —
   at least 5 user/assistant pairs on a model whose `maxTokens` is below
   its input limit — target `maxInputTokens * 0.5` instead, so repeated
   compactions don't thrash near the ceiling. Manual mode targets
   `manualTargetRatio` (default 0.5, clamped to 0.05–0.95) of the current
   message tokens.
4. **Request → message translation.** System prompt and tool definitions
   cannot be compacted, so their overhead is subtracted from the request
   budget to produce the message-transcript budget handed to the strategy
   (`CoreCompactionBudget` carries both views).

## Strategies

### Agentic (default)

[`agentic-compaction.ts`](../src/extensions/context/agentic-compaction.ts)
summarizes older history with an LLM call:

- `findCutIndex` walks backwards accumulating `preserveRecentTokens`
  (default 20k, clamped to the message target) of verbatim tail, then snaps
  to a *safe cut boundary*: an assistant message or a typed user turn.
  A tool_result-only user message is never a boundary — its matching
  `tool_use` sits in the preceding assistant message and would be orphaned.
  The latest typed user prompt is never folded into the summary.
- Compaction is **incremental**: if a previous compaction summary exists in
  the fold span, only messages after it are serialized, and the previous
  summary text is passed to the summarizer for continuity.
- The summary request is budgeted against the summarizer model's own input
  limit (falling back to the active model's compaction budget when no
  dedicated summarizer is configured) through `buildBudgetProjection`.
- The result replaces the folded span with a single user message whose
  metadata is `kind: "compaction_summary"` (summary text, read/modified
  file lists, `tokensBefore`, `generatedAt`), followed by the preserved
  tail verbatim.
- Returns `undefined` (a skip, not an error) when there is nothing useful
  to do: fewer than 2 messages, no valid cut, no new messages to fold,
  summarizer budget exhausted, or an empty summary came back.

### Basic

[`basic-compaction.ts`](../src/extensions/context/basic-compaction.ts) is
the deterministic, no-LLM fold. It is the explicit-opt-in strategy and the
runtime fallback when agentic fails:

- Typed user prompts always survive. The latest typed turn keeps its newest
  messages within budget (the kept suffix starts at an assistant message so
  no tool pair is split); older turns keep their concluding assistant
  answer when it fits, newest turns first.
- Dropped spans are re-surfaced as `<SYSTEM_NOTICE>` blocks attached to the
  surviving prompts: files read/edited (with line ranges when known),
  commands run, and the last 3 assistant text responses verbatim.
- Survivors that aren't typed prompts are frozen with
  `metadata.compaction: "preserved"` so a later pass never re-folds them;
  the first message accumulates `kind: "compaction"` metadata with running
  `messagesRemoved` and aggregated usage totals. Per-message `metrics` are
  stripped from the compacted result because they no longer add up.

## The compaction sidecar

`createCompactionStateAwarePrepareTurn` persists a
`SessionCompactionState`
([`session/models/session-compaction.ts`](../src/session/models/session-compaction.ts))
next to the session messages as `${sessionId}.compaction.json` (recorded in
the session manifest as `compaction_path`):

- v1 schema: `source_message_count`, `source_prefix_hash` (sha256 over the
  normalized canonical prefix the state covers), a legacy
  `source_last_message_key` anchor, the compacted `messages`, and an
  optional `system_prompt`.
- **Projection on resume:** the state is reused only if the hash of the
  canonical prefix still matches; canonical messages written after the
  compaction boundary are appended to the compacted messages. On any
  mismatch the state is silently ignored and the full canonical transcript
  is used.
- **Re-compaction** starts from the projection (compacted prefix +
  canonical tail), keeping automatic turns bounded without rebuilding a
  full-transcript summary every turn. A manual `/compact` (CLI path,
  [`apps/cli/src/runtime/interactive/compaction.ts`](../../../../apps/cli/src/runtime/interactive/compaction.ts))
  intentionally re-summarizes the **full canonical transcript** to avoid
  summary-of-summary drift.
- Writes are serialized per session and stale states (covering fewer
  canonical messages than the current one) are dropped.

Constraint: the hash format is a persisted contract. Changing
`sourcePrefixHash` or the boundary-key format invalidates every existing
sidecar (sessions then fall back to the uncompacted canonical transcript —
correct but slower/costlier on the next turn).

## Observability

Status notices (via the runtime's `emitStatusNotice`, rendered by the CLI
TUI and the VS Code webview):

| Notice | When |
|---|---|
| `auto-compacting` / `compacting` | strategy started (auto / manual) |
| `auto-compacted` / `compacted` | strategy produced a result |
| `auto-compaction-skipped` / `compaction-skipped` | strategy returned `undefined` |
| `compaction-budget-adjusted` | budget projection had to degrade content |

Telemetry (see
[`services/telemetry/core-events.ts`](../src/services/telemetry/core-events.ts)):
`task.compaction_executed` on success, `task.compaction_skipped` on a skip,
plus a budget-emergency event when the projection acted. Events are keyed
by the host session id (falling back to the conversation id) and tagged
with provider/model, strategy, and mode. Known gap: compactions performed
via plugin `registerMessageBuilder()` or the `beforeModel` hook bypass this
pipeline and emit no compaction telemetry.

Every prepared turn also logs a `Context compaction diagnostics` debug line
with the full budget breakdown when a logger is configured.

## Testing compaction changes

- Unit tests: `bun -F @cline/core test:unit` (see
  [`compaction.test.ts`](../src/extensions/context/compaction.test.ts) and
  `session-compaction.test.ts`).
- Live tests against a real provider:
  `bun -F @cline/core test:live` (requires provider credentials).
- Offline strategy harness — run either strategy against a captured
  session transcript and inspect/diff the output:

  ```sh
  bun -F @cline/core test:compaction -- <session-directory> \
    --strategy both \
    --provider anthropic --model claude-sonnet-4-6 \
    --output /tmp/compacted.json
  ```

  The directory must contain `messages.json` or exactly one
  `*.messages.json` file (e.g. copied from
  `~/.cline/data/sessions/<sessionId>/`); note that `bun -F` runs from the
  package directory, so relative paths resolve against `packages/core` —
  prefer absolute paths. Basic compaction runs fully offline (try it on the
  checked-in fixture: `bun -F @cline/core test:compaction -- fixtures/session
  --strategy basic`); agentic needs `--provider`/`--model` and an API key
  from the provider's usual env var. See
  [`scripts/compact-session.ts`](../scripts/compact-session.ts).

## Host integration points

- **LocalRuntimeHost** (`src/runtime/host/local-runtime-host.ts`): the auto
  pipeline described here; sidecar persistence and resume validation.
- **CLI** (`apps/cli/src/runtime/interactive/compaction.ts`): `/compact`
  builds a manual-mode prepare-turn (`{ mode: "manual" }`) over the full
  canonical transcript and persists the resulting sidecar.
- **VS Code extension** (`apps/vscode/src/sdk/sdk-compaction.ts`): manual
  compaction for extension-hosted sessions; the summarizer's provider
  config must resolve `baseUrl` and `knownModels` from extension state so
  agentic summarization budgets against the real model instead of silently
  falling back (see #12563 for the failure mode this guards against).
