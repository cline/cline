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
	| {
			status: "recovery_dismissed";
			dashboardUrl: string;
			retryDraft?: string;
			retryAttachments?: File[];
	  }
	| { status: "failed"; retryDraft?: string; retryAttachments?: File[] }
	| {
			status: "retry_restored";
			dashboardUrl?: string;
			retryDraft?: string;
			retryAttachments?: File[];
	  }
	| {
			status: "complete";
			receipt: HandoffReceipt;
			externalPresentation: boolean;
			retryDraft?: string;
			retryAttachments?: File[];
	  };

export type CloudHandoffUiState = Record<string, CloudHandoffUiEntry>;

export function hasLivePendingHandoff(
	entry: CloudHandoffUiEntry | undefined,
): boolean {
	return (
		entry?.status === "recovery" ||
		entry?.status === "recovery_dismissed" ||
		(entry?.status === "retry_restored" && Boolean(entry.dashboardUrl))
	);
}

export function resolveHandoffReceipt(
	live: CloudHandoffUiEntry | undefined,
	persisted: HandoffReceipt | null,
): HandoffReceipt | null {
	if (!live) return persisted;
	return live.status === "complete" ? live.receipt : persisted;
}

export type CloudHandoffUiAction =
	| {
			type: "start";
			sourceSessionId: string;
	  }
	| {
			type: "progress";
			sourceSessionId: string;
			phase: Exclude<HandoffProgressPhase, "complete">;
			message?: string;
			dashboardUrl?: string;
	  }
	| {
			type: "failed";
			sourceSessionId: string;
			retryDraft?: string;
			retryAttachments?: File[];
	  }
	| {
			type: "complete";
			sourceSessionId: string;
			receipt: HandoffReceipt;
			externalPresentation: boolean;
			retryDraft?: string;
			retryAttachments?: File[];
	  }
	| { type: "external"; sourceSessionId: string }
	| {
			type: "dismiss_recovery";
			sourceSessionId: string;
			dashboardUrl: string;
	  }
	| { type: "retry_restored"; sourceSessionId: string }
	| { type: "local_prompt_delivered"; sourceSessionId: string }
	| { type: "retry_delivered"; sourceSessionId: string };

export function cloudHandoffUiReducer(
	state: CloudHandoffUiState,
	action: CloudHandoffUiAction,
): CloudHandoffUiState {
	const current = state[action.sourceSessionId];
	switch (action.type) {
		case "start": {
			// A retry of a pending handoff must not discard the recovery URL:
			// if the retry fails before any progress event re-supplies it, the
			// dashboard link would be gone from live state entirely.
			const carriedDashboardUrl =
				current?.status === "recovery" ||
				current?.status === "recovery_dismissed" ||
				current?.status === "progress"
					? current.dashboardUrl
					: undefined;
			return {
				...state,
				[action.sourceSessionId]: {
					status: "progress",
					phase: "checking",
					...(carriedDashboardUrl ? { dashboardUrl: carriedDashboardUrl } : {}),
				},
			};
		}
		case "progress":
			if (
				current?.status === "complete" ||
				current?.status === "failed" ||
				current?.status === "recovery" ||
				current?.status === "recovery_dismissed" ||
				current?.status === "retry_restored"
			) {
				return state;
			}
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
			// An authoritative completion event may have already landed while
			// the RPC transport failed; the receipt (and its cloud URL) must
			// survive, since the source session is locked either way.
			if (current?.status === "complete") {
				if (!action.retryDraft && !action.retryAttachments?.length)
					return state;
				return {
					...state,
					[action.sourceSessionId]: {
						...current,
						retryDraft: action.retryDraft,
						retryAttachments: action.retryAttachments,
					},
				};
			}
			const dashboardUrl =
				current?.status === "progress" ? current.dashboardUrl : undefined;
			if (dashboardUrl) {
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
					...(action.retryDraft ? { retryDraft: action.retryDraft } : {}),
					...(action.retryAttachments?.length
						? { retryAttachments: action.retryAttachments }
						: {}),
				},
			};
		case "external": {
			if (current?.status !== "complete") return state;
			return {
				...state,
				[action.sourceSessionId]: {
					...current,
					externalPresentation: true,
				},
			};
		}
		case "dismiss_recovery":
			if (current?.status === "complete" || current?.status === "progress") {
				return state;
			}
			return {
				...state,
				[action.sourceSessionId]: {
					status: "recovery_dismissed",
					dashboardUrl: action.dashboardUrl,
					...(current && "retryDraft" in current
						? { retryDraft: current.retryDraft }
						: {}),
					...(current && "retryAttachments" in current
						? { retryAttachments: current.retryAttachments }
						: {}),
				},
			};
		case "retry_restored":
			if (current?.status === "failed") {
				return {
					...state,
					[action.sourceSessionId]: {
						status: "retry_restored",
						retryDraft: current.retryDraft,
						retryAttachments: current.retryAttachments,
					},
				};
			}
			if (current?.status === "recovery") {
				return {
					...state,
					[action.sourceSessionId]: {
						status: "retry_restored",
						dashboardUrl: current.dashboardUrl,
						retryDraft: current.retryDraft,
						retryAttachments: current.retryAttachments,
					},
				};
			}
			return state;
		case "local_prompt_delivered": {
			if (
				current?.status !== "failed" &&
				!(current?.status === "retry_restored" && !current.dashboardUrl)
			)
				return state;
			const next = { ...state };
			delete next[action.sourceSessionId];
			return next;
		}
		case "retry_delivered": {
			if (!current) return state;
			if (current.status !== "complete") {
				if (
					current.status !== "recovery" &&
					current.status !== "recovery_dismissed" &&
					current.status !== "failed" &&
					current.status !== "retry_restored"
				) {
					return state;
				}
				const next = { ...state };
				delete next[action.sourceSessionId];
				return next;
			}
			return {
				...state,
				[action.sourceSessionId]: {
					status: "complete",
					receipt: current.receipt,
					externalPresentation: current.externalPresentation,
				},
			};
		}
	}
}
