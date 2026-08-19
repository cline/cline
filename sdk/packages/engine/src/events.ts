/**
 * `EngineEvent` — the canonical, ordered event stream of one execution
 * (Gateway RFC, Phase 1).
 *
 * Every event carries the run's ID and a per-run monotonically increasing
 * `sequence` starting at 0. Ordering is total within a run and meaningless
 * across runs.
 */

import type { AgentMessage, AgentUsage, GeneratedMedia } from "@cline/shared";
import type { EngineErrorInfo, EngineRunResult } from "./result";

export interface EngineEventBase {
	sequence: number;
	runId: string;
	/** Injected-clock timestamp (epoch ms). */
	timestamp: number;
}

export type EngineEventPayload =
	| { type: "run-started" }
	| { type: "turn-started"; iteration: number }
	| {
			type: "message-appended";
			message: AgentMessage;
			/** Position in the canonical transcript (incl. initial messages). */
			index: number;
	  }
	| { type: "text-delta"; text: string }
	| { type: "reasoning-delta"; text: string; redacted?: boolean }
	| { type: "media"; media: GeneratedMedia }
	| {
			type: "tool-started";
			toolCallId: string;
			toolName: string;
			input: unknown;
	  }
	| {
			type: "tool-updated";
			toolCallId: string;
			toolName: string;
			update: unknown;
	  }
	| {
			type: "tool-finished";
			toolCallId: string;
			toolName: string;
			output: unknown;
			isError?: boolean;
	  }
	| {
			type: "approval-requested";
			toolCallId: string;
			toolName: string;
			input: unknown;
	  }
	| {
			type: "approval-resolved";
			toolCallId: string;
			toolName: string;
			approved: boolean;
			reason?: string;
	  }
	| { type: "steer-queued"; text: string }
	| { type: "steer-merged"; text: string }
	| { type: "interrupt-requested"; reason?: string }
	| { type: "abort-requested"; reason?: string }
	| { type: "usage-updated"; usage: AgentUsage }
	| { type: "turn-finished"; iteration: number; toolCallCount: number }
	| { type: "status"; message: string; metadata?: Record<string, unknown> }
	| { type: "artifact-created"; name: string; mediaType?: string }
	| { type: "run-finished"; result: EngineRunResult }
	| { type: "run-failed"; error: EngineErrorInfo; result: EngineRunResult };

export type EngineEvent = EngineEventBase & EngineEventPayload;

export type EngineEventListener = (event: EngineEvent) => void;
