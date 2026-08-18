import type { HandoffProgressPhase, HandoffReceipt } from "@/lib/cloud-handoff";

export type CloudHandoffUiEntry =
	| {
			status: "progress";
			phase: HandoffProgressPhase;
			message?: string;
			dashboardUrl?: string;
	  }
	| {
			status: "recovery";
			dashboardUrl: string;
			retryDraft?: string;
			retryAttachments?: File[];
	  }
	| { status: "failed"; retryDraft?: string; retryAttachments?: File[] }
	| {
			status: "complete";
			receipt: HandoffReceipt;
			externalPresentation: boolean;
	  };

export type CloudHandoffUiState = Record<string, CloudHandoffUiEntry>;

export type CloudHandoffUiAction =
	| {
			type: "progress";
			sourceSessionId: string;
			phase: HandoffProgressPhase;
			message?: string;
			dashboardUrl?: string;
	  }
	| {
			type: "failed";
			sourceSessionId: string;
			exposeRecovery: boolean;
			retryDraft?: string;
			retryAttachments?: File[];
	  }
	| {
			type: "complete";
			sourceSessionId: string;
			receipt: HandoffReceipt;
			externalPresentation: boolean;
	  }
	| { type: "external"; sourceSessionId: string }
	| { type: "retry_restored"; sourceSessionId: string };

export function cloudHandoffUiReducer(
	state: CloudHandoffUiState,
	action: CloudHandoffUiAction,
): CloudHandoffUiState {
	const current = state[action.sourceSessionId];
	switch (action.type) {
		case "progress":
			if (current?.status === "complete") return state;
			return {
				...state,
				[action.sourceSessionId]: {
					status: "progress",
					phase: action.phase,
					message: action.message,
					dashboardUrl:
						action.dashboardUrl ||
						(current?.status === "progress" ? current.dashboardUrl : undefined),
				},
			};
		case "failed": {
			const dashboardUrl =
				current?.status === "progress" ? current.dashboardUrl : undefined;
			if (action.exposeRecovery && dashboardUrl) {
				return {
					...state,
					[action.sourceSessionId]: {
						status: "recovery",
						dashboardUrl,
						retryDraft: action.retryDraft,
						retryAttachments: action.retryAttachments,
					},
				};
			}
			return {
				...state,
				[action.sourceSessionId]: {
					status: "failed",
					retryDraft: action.retryDraft,
					retryAttachments: action.retryAttachments,
				},
			};
		}
		case "complete":
			return {
				...state,
				[action.sourceSessionId]: {
					status: "complete",
					receipt: action.receipt,
					externalPresentation: action.externalPresentation,
				},
			};
		case "external":
			return current?.status === "complete"
				? {
						...state,
						[action.sourceSessionId]: {
							...current,
							externalPresentation: true,
						},
					}
				: state;
		case "retry_restored":
			if (current?.status === "failed") {
				const { [action.sourceSessionId]: _removed, ...rest } = state;
				return rest;
			}
			if (current?.status === "recovery") {
				return {
					...state,
					[action.sourceSessionId]: {
						status: "recovery",
						dashboardUrl: current.dashboardUrl,
					},
				};
			}
			return state;
	}
}
