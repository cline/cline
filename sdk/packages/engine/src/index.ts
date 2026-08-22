/**
 * `@cline/engine`
 *
 * Owns exactly one execution (Gateway RFC, Phase 1): consumes an immutable
 * `RunSpec`, drives the `@cline/agents` loop with `@cline/llms` handlers,
 * emits canonical ordered `EngineEvent` values, supports cooperative steer,
 * interrupt, and abort, and returns an `EngineRunResult` plus persistence
 * deltas.
 *
 * This package never imports `@cline/bot`, `@cline/gateway`, or
 * `@cline/core`, and contains no storage, discovery, socket, or daemon
 * code. See `src/boundaries.test.ts` for the machine-checked rules.
 */

// Convenience re-exports so consumers (e.g. `@cline/bot`) can build specs
// without importing `@cline/agents` directly.
export type {
	AgentMessage,
	AgentMessagePart,
	AgentModel,
	AgentModelEvent,
	AgentRuntimeHooks,
	AgentTool,
	AgentUsage,
	ToolApprovalRequest,
	ToolApprovalResult,
	ToolPolicy,
} from "@cline/shared";
export type { EngineStatus } from "./engine";
export { createEngine, Engine, EngineStateError } from "./engine";
export type {
	EngineEvent,
	EngineEventBase,
	EngineEventListener,
	EngineEventPayload,
} from "./events";
export type {
	EngineErrorInfo,
	EnginePersistenceDelta,
	EngineRunResult,
	EngineRunStatus,
} from "./result";
export type {
	EngineApprovalPort,
	EngineArtifact,
	EngineArtifactSink,
	EngineClock,
	EngineModelBinding,
	EngineOptions,
	RunSpec,
} from "./run-spec";
export { SYSTEM_CLOCK } from "./run-spec";
