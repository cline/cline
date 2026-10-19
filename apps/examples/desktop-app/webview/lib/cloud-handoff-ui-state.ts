import type { HandoffProgressPhase } from "./cloud-handoff";

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
			type: "complete";
			sourceSessionId: string;
			sessionId: string;
			dashboardUrl: string;
			message?: string;
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
		case "complete":
			return {
				...state,
				[action.sourceSessionId]: {
					status: "complete",
					sessionId: action.sessionId,
					dashboardUrl: action.dashboardUrl,
					message: action.message,
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
