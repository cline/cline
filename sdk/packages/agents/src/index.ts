/**
 * @clinebot/agents
 *
 * Browser-safe agent runtime for the next-generation Cline SDK.
 *
 * Final clean shape per PLAN.md §1.3 + §3.6 Step 9. The package is a
 * thin, stateless agentic-loop executor that exports:
 *
 *   - `AgentRuntime` / `createAgentRuntime` — the per-run loop itself
 *   - `AgentRunInput` / `AgentEventListener` — convenience type aliases
 *   - `createTool` — re-exported from `@clinebot/shared` for authoring tools
 *   - all shared types — re-exported via `export type *`
 *
 * Every stateful concern (conversation store, session identity,
 * OAuth/connection refresh, loop-detection counters, consecutive-mistake
 * tracking, team/delegated-agent orchestration, message-builder caches,
 * hook-file glue) now lives in `@clinebot/core`. The legacy `Agent`
 * class and its supporting files were deleted in Step 9; consumers who
 * need the legacy facade import it from `@clinebot/core` instead.
 */

export type * from "@clinebot/shared";
export { createTool } from "@clinebot/shared";
export type { AgentEventListener, AgentRunInput } from "./agent-runtime";
export {
	AgentRuntime,
	AgentRuntime as Agent,
	createAgentRuntime,
	createAgentRuntime as createAgent,
} from "./agent-runtime";
