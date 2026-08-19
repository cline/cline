/**
 * `RunResult` and persistence deltas (Gateway RFC, Phase 1).
 *
 * The engine never persists anything. It returns what happened plus the
 * minimal set of deltas a caller (the Gateway, eventually) must apply to
 * its canonical stores to make the run durable.
 */

import type { AgentMessage, AgentUsage } from "@cline/shared";

export type EngineRunStatus =
	| "completed"
	| "failed"
	| "aborted"
	| "interrupted";

export interface EngineErrorInfo {
	name: string;
	message: string;
}

export type EnginePersistenceDelta =
	| {
			kind: "message-appended";
			/** Position in the canonical transcript (incl. initial messages). */
			index: number;
			message: AgentMessage;
	  }
	| { kind: "usage-updated"; usage: AgentUsage }
	| { kind: "run-status-changed"; status: EngineRunStatus };

export interface EngineRunResult {
	runId: string;
	status: EngineRunStatus;
	outputText: string;
	/** Full canonical transcript after the run. */
	messages: readonly AgentMessage[];
	usage: AgentUsage;
	iterations: number;
	startedAt: number;
	endedAt: number;
	error?: EngineErrorInfo;
	/** Ordered deltas the caller applies to its stores. */
	persistence: readonly EnginePersistenceDelta[];
}
