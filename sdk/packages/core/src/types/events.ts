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

export interface SessionPendingPrompt {
	id: string;
	prompt: string;
	delivery: "queue" | "steer";
	attachmentCount: number;
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
}

export interface SessionSnapshotEvent {
	sessionId: string;
	snapshot: CoreSessionSnapshot;
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
	| { type: "session_snapshot"; payload: SessionSnapshotEvent }
	| { type: "ended"; payload: SessionEndedEvent }
	| { type: "hook"; payload: SessionToolEvent }
	| { type: "status"; payload: { sessionId: string; status: string } };
