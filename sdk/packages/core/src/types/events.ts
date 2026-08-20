import type { MonitorRecord } from "../extensions/tools/executors/monitor";
import type { CoreSessionSnapshot } from "../session/session-snapshot";

export interface SessionChunkEvent {
	sessionId: string;
	stream: "stdout" | "stderr" | "agent";
	chunk: string;
	ts: number;
}

export interface SessionEndedEvent {
	sessionId: string;
	reason: string;
	ts: number;
}

export interface SessionToolEvent {
	sessionId: string;
	hookEventName:
		| "tool_call"
		| "tool_result"
		| "agent_end"
		| "agent_error"
		| "session_shutdown";
	agentId?: string;
	conversationId?: string;
	parentAgentId?: string;
	iteration?: number;
	toolName?: string;
	inputTokens?: number;
	outputTokens?: number;
	ts?: string;
}

export interface SessionTeamProgressEvent {
	sessionId: string;
	teamName: string;
	lifecycle: import("@cline/shared").TeamProgressLifecycleEvent;
	summary: import("@cline/shared").TeamProgressSummary;
}

/**
 * One monitor notification folded into a pending prompt. Mirrors the
 * agent-facing text (which stays fully fenced for injection defense) with
 * structured fields so UIs can render a clean card instead of the fence.
 */
export interface MonitorPromptUpdate {
	monitorId: string;
	name: string;
	description: string;
	lines: string[];
	droppedLines?: number;
	exit?: {
		status: "exited" | "stopped" | "failed";
		stoppedBy?: "user";
		code?: number | null;
		signal?: string | null;
		error?: string;
	};
}

export interface MonitorPromptOrigin {
	kind: "monitor";
	/** In delivery order; the steer queue appends as it merges reports. */
	updates: MonitorPromptUpdate[];
	/**
	 * Updates dropped from the front of `updates` to bound the origin. The
	 * model-facing text has its own (character) bound, so the card set can
	 * shrink before the text does; a nonzero count tells UIs to say that
	 * earlier updates were omitted instead of silently underreporting what
	 * the model saw.
	 */
	droppedUpdates?: number;
}

/**
 * Structured provenance for a runtime-generated pending prompt. The prompt
 * text is what the model receives; UIs that recognize the origin render from
 * it instead of showing the model-facing framing to the user.
 */
export type PendingPromptOrigin = MonitorPromptOrigin;

export interface SessionPendingPrompt {
	id: string;
	prompt: string;
	delivery: "queue" | "steer";
	attachmentCount: number;
	userImages?: string[];
	userFiles?: string[];
	origin?: PendingPromptOrigin;
}

export interface SessionPendingPromptsEvent {
	sessionId: string;
	prompts: SessionPendingPrompt[];
}

export interface SessionPendingPromptSubmittedEvent {
	sessionId: string;
	id: string;
	prompt: string;
	delivery: "queue" | "steer";
	attachmentCount: number;
	userImages?: string[];
	userFiles?: string[];
	origin?: PendingPromptOrigin;
}

export interface SessionSnapshotEvent {
	sessionId: string;
	snapshot: CoreSessionSnapshot;
}

/**
 * Full snapshot of the session's background monitors, emitted whenever any
 * monitor's lifecycle state changes. A snapshot rather than a delta so UIs
 * can render directly from the latest event without replaying history, and
 * so a registry disposal (session shutdown or runtime restart) is visible as
 * an explicit empty/ended state instead of silence.
 */
export interface SessionMonitorStateEvent {
	sessionId: string;
	monitors: MonitorRecord[];
}

export type CoreSessionEvent =
	| { type: "chunk"; payload: SessionChunkEvent }
	| {
			type: "agent_event";
			payload: {
				sessionId: string;
				event: import("@cline/shared").AgentEvent;
				/** Identifies the named agent within the team (e.g. "educator", "assessor", "coordinator") for both lead and teammate agents */
				teamAgentId?: string;
				/** Whether this is the lead agent or a teammate */
				teamRole?: "lead" | "teammate";
			};
	  }
	| { type: "team_progress"; payload: SessionTeamProgressEvent }
	| { type: "pending_prompts"; payload: SessionPendingPromptsEvent }
	| {
			type: "pending_prompt_submitted";
			payload: SessionPendingPromptSubmittedEvent;
	  }
	| { type: "monitor_state"; payload: SessionMonitorStateEvent }
	| { type: "session_snapshot"; payload: SessionSnapshotEvent }
	| { type: "ended"; payload: SessionEndedEvent }
	| { type: "hook"; payload: SessionToolEvent }
	| { type: "status"; payload: { sessionId: string; status: string } };
