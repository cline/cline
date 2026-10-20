import type { HandoffProgressPhase } from "./cloud-handoff";

export type HandoffDraft = { text: string; attachments: File[] };

export type CloudHandoffUiEntry =
	| {
			status: "progress";
			phase: Exclude<HandoffProgressPhase, "complete">;
			message?: string;
			dashboardUrl?: string;
			sessionId?: string;
	  }
	| {
			status: "complete";
			sessionId: string;
			dashboardUrl: string;
			message?: string;
			unsentDraft?: HandoffDraft;
	  }
	| {
			status: "failed" | "retry_restored";
			message: string;
			retryDraft: string;
			retryAttachments: File[];
	  };

export type CloudHandoffUiState = Record<string, CloudHandoffUiEntry>;

export type CloudHandoffUiAction =
	| {
			type: "start" | "dismiss" | "local_prompt_delivered" | "retry_restored";
			sourceSessionId: string;
	  }
	| {
			type: "cloud_draft_restored";
			sourceSessionId: string;
			draft: HandoffDraft;
	  }
	| {
			type: "complete";
			sourceSessionId: string;
			sessionId: string;
			dashboardUrl: string;
			message?: string;
			unsentDraft?: HandoffDraft;
	  }
	| {
			type: "progress";
			sourceSessionId: string;
			phase: Exclude<HandoffProgressPhase, "complete">;
			message?: string;
			dashboardUrl?: string;
			sessionId?: string;
	  }
	| {
			type: "failed";
			sourceSessionId: string;
			retryDraft: string;
			retryAttachments: File[];
			message: string;
	  };

export function cloudHandoffUiReducer(
	state: CloudHandoffUiState,
	action: CloudHandoffUiAction,
): CloudHandoffUiState {
	const current = state[action.sourceSessionId];
	switch (action.type) {
		case "start":
			return {
				...state,
				[action.sourceSessionId]: { status: "progress", phase: "checking" },
			};
		case "progress":
			if (current?.status !== "progress") return state;
			return {
				...state,
				[action.sourceSessionId]: {
					status: "progress",
					phase: action.phase,
					message: action.message,
					dashboardUrl: action.dashboardUrl ?? current.dashboardUrl,
					sessionId: action.sessionId ?? current.sessionId,
				},
			};
		case "failed":
			return {
				...state,
				[action.sourceSessionId]: {
					status: "failed",
					message: action.message,
					retryDraft: action.retryDraft,
					retryAttachments: action.retryAttachments,
				},
			};
		case "retry_restored":
			return current?.status === "failed"
				? {
						...state,
						[action.sourceSessionId]: { ...current, status: "retry_restored" },
					}
				: state;
		case "cloud_draft_restored":
			return current?.status === "complete" &&
				current.unsentDraft === action.draft
				? {
						...state,
						[action.sourceSessionId]: { ...current, unsentDraft: undefined },
					}
				: state;
		case "complete":
			return {
				...state,
				[action.sourceSessionId]: {
					status: "complete",
					sessionId: action.sessionId,
					dashboardUrl: action.dashboardUrl,
					message: action.message,
					unsentDraft: action.unsentDraft,
				},
			};
		case "local_prompt_delivered":
		case "dismiss": {
			if (
				action.type === "local_prompt_delivered" &&
				current?.status !== "retry_restored"
			)
				return state;
			const next = { ...state };
			delete next[action.sourceSessionId];
			return next;
		}
	}
}
