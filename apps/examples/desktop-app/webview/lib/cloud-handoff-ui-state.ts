import type { HandoffProgressPhase } from "./cloud-handoff";

export type HandoffDraft = { text: string; attachments: File[] };

type HandoffStatus =
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
			status: "failed";
			message: string;
			connectUrl?: string;
			retryDraft: string;
			retryAttachments: File[];
	  };

export type CloudHandoffUiEntry = HandoffStatus & {
	preparing?: true;
	preparationFailure?: {
		message: string;
		connectUrl?: string;
		draft: HandoffDraft;
	};
};

export type CloudHandoffUiState = Record<string, CloudHandoffUiEntry>;

export type CloudHandoffUiAction =
	| {
			type: "prepare" | "start" | "dismiss" | "preparation_draft_restored";
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
			type: "failed" | "preparation_failed";
			sourceSessionId: string;
			retryDraft: string;
			retryAttachments: File[];
			message: string;
			connectUrl?: string;
	  };

export function cloudHandoffUiReducer(
	state: CloudHandoffUiState,
	action: CloudHandoffUiAction,
): CloudHandoffUiState {
	const current = state[action.sourceSessionId];
	switch (action.type) {
		case "preparation_draft_restored":
			return current
				? {
						...state,
						[action.sourceSessionId]: {
							...current,
							preparationFailure: undefined,
						},
					}
				: state;
		case "prepare":
			return {
				...state,
				[action.sourceSessionId]: {
					...(current ?? { status: "progress", phase: "checking" }),
					preparing: true,
				},
			};
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
					preparing: current.preparing,
					preparationFailure: current.preparationFailure,
					phase: action.phase,
					message: action.message,
					dashboardUrl: action.dashboardUrl ?? current.dashboardUrl,
					sessionId: action.sessionId ?? current.sessionId,
				},
			};
		case "preparation_failed":
		case "failed": {
			const preparationFailure =
				action.type === "preparation_failed"
					? {
							message: action.message,
							connectUrl: action.connectUrl,
							draft: {
								text: action.retryDraft,
								attachments: action.retryAttachments,
							},
						}
					: current?.preparationFailure;
			return {
				...state,
				[action.sourceSessionId]: {
					...(action.type === "preparation_failed" &&
					(current?.status === "complete" ||
						(current?.status === "progress" && current.sessionId))
						? current
						: {
								status: "failed",
								message: action.message,
								connectUrl: action.connectUrl,
								retryDraft: action.retryDraft,
								retryAttachments: action.retryAttachments,
							}),
					preparationFailure,
					preparing:
						action.type === "preparation_failed"
							? undefined
							: current?.preparing,
				},
			};
		}
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
					preparing: current?.preparing,
					sessionId: action.sessionId,
					dashboardUrl: action.dashboardUrl,
					message: action.message,
					unsentDraft: action.unsentDraft,
					preparationFailure: current?.preparationFailure,
				},
			};
		case "dismiss": {
			const next = { ...state };
			delete next[action.sourceSessionId];
			return next;
		}
	}
}
