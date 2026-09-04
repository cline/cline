import { formatDisplayUserInput } from "@cline/shared/browser";
import type { ChatMessage } from "@/lib/chat-schema";
import type { HandoffProgressPhase, HandoffReceipt } from "@/lib/cloud-handoff";

export type PendingHandoffPrompt = {
	content: string;
	submittedAt: number;
	baselineOccurrences: number;
	baselineTailMessageId?: string;
	images?: ChatMessage["images"];
};

export type CloudHandoffUiEntry =
	| {
			status: "progress";
			phase: HandoffProgressPhase;
			message?: string;
			dashboardUrl?: string;
			pendingPrompt?: PendingHandoffPrompt;
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
	| { status: "target_prompt"; pendingPrompt: PendingHandoffPrompt }
	| {
			status: "complete";
			receipt: HandoffReceipt;
			externalPresentation: boolean;
			/** Follow-up queue outcome, carried so a lost RPC response can
			 * still drive the definite-failure restoration. */
			warningKind?: "unqueued" | "unconfirmed";
			retryDraft?: string;
			retryAttachments?: File[];
			retainRetry?: boolean;
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
			pendingPrompt?: PendingHandoffPrompt;
	  }
	| {
			type: "progress";
			sourceSessionId: string;
			phase: HandoffProgressPhase;
			message?: string;
			dashboardUrl?: string;
			sessionId?: string;
			destination?: "in_app" | "external";
			warningKind?: "unqueued" | "unconfirmed";
			retryDraft?: string;
			retryAttachments?: File[];
			retainRetry?: boolean;
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
			pendingPrompt?: PendingHandoffPrompt;
			warningKind?: "unqueued" | "unconfirmed";
			retryDraft?: string;
			retryAttachments?: File[];
	  }
	| {
			type: "target_open_failed";
			sourceSessionId: string;
			dashboardUrl: string;
			retryDraft?: string;
			retryAttachments?: File[];
	  }
	| { type: "external"; sourceSessionId: string }
	| { type: "prompt_reconciled"; sourceSessionId: string }
	| {
			type: "dismiss_recovery";
			sourceSessionId: string;
			dashboardUrl: string;
	  }
	| { type: "retry_restored"; sourceSessionId: string }
	| { type: "retry_delivered"; sourceSessionId: string };

function completeHandoff(
	state: CloudHandoffUiState,
	sourceSessionId: string,
	receipt: HandoffReceipt,
	externalPresentation: boolean,
	pendingPrompt?: PendingHandoffPrompt,
	warningKind?: "unqueued" | "unconfirmed",
	retryDraft?: string,
	retryAttachments?: File[],
	retainRetry = false,
): CloudHandoffUiState {
	const current = state[sourceSessionId];
	const carriedRetryDraft =
		retryDraft ??
		(retainRetry &&
		(current?.status === "failed" ||
			current?.status === "recovery" ||
			current?.status === "retry_restored" ||
			current?.status === "complete")
			? current.retryDraft
			: undefined);
	const carriedRetryAttachments =
		retryAttachments ??
		(retainRetry &&
		(current?.status === "failed" ||
			current?.status === "recovery" ||
			current?.status === "retry_restored" ||
			current?.status === "complete")
			? current.retryAttachments
			: undefined);
	return {
		...state,
		[sourceSessionId]: {
			status: "complete",
			receipt,
			externalPresentation,
			...(warningKind ? { warningKind } : {}),
			...(carriedRetryDraft ? { retryDraft: carriedRetryDraft } : {}),
			...(carriedRetryAttachments?.length
				? { retryAttachments: carriedRetryAttachments }
				: {}),
		},
		...(!externalPresentation && pendingPrompt
			? {
					[receipt.targetSessionId]: {
						status: "target_prompt" as const,
						pendingPrompt,
					},
				}
			: {}),
	};
}

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
					...(action.pendingPrompt
						? { pendingPrompt: action.pendingPrompt }
						: {}),
				},
			};
		}
		case "progress":
			if (
				action.phase === "complete" &&
				action.sessionId?.trim() &&
				action.dashboardUrl?.trim()
			) {
				return completeHandoff(
					state,
					action.sourceSessionId,
					{
						targetSessionId: action.sessionId,
						dashboardUrl: action.dashboardUrl,
					},
					action.destination === "external",
					undefined,
					action.warningKind,
					action.retryDraft,
					action.retryAttachments,
					action.retainRetry,
				);
			}
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
					pendingPrompt:
						current?.status === "progress" ? current.pendingPrompt : undefined,
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
			return completeHandoff(
				state,
				action.sourceSessionId,
				action.receipt,
				action.externalPresentation,
				action.pendingPrompt,
				action.warningKind,
				action.retryDraft,
				action.retryAttachments,
			);
		case "target_open_failed":
			if (current?.status === "complete") {
				return {
					...state,
					[action.sourceSessionId]: {
						...current,
						retryDraft: action.retryDraft,
						retryAttachments: action.retryAttachments,
					},
				};
			}
			return {
				...state,
				[action.sourceSessionId]: {
					status: "recovery",
					dashboardUrl: action.dashboardUrl,
					retryDraft: action.retryDraft,
					retryAttachments: action.retryAttachments,
				},
			};
		case "external": {
			if (current?.status !== "complete") return state;
			const next = {
				...state,
				[action.sourceSessionId]: {
					...current,
					externalPresentation: true,
				},
			};
			if (next[current.receipt.targetSessionId]?.status === "target_prompt") {
				delete next[current.receipt.targetSessionId];
			}
			return next;
		}
		case "prompt_reconciled": {
			if (current?.status !== "target_prompt") return state;
			const next = { ...state };
			delete next[action.sourceSessionId];
			return next;
		}
		case "dismiss_recovery":
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
		case "retry_delivered": {
			if (current?.status !== "complete") return state;
			return {
				...state,
				[action.sourceSessionId]: {
					status: "complete",
					receipt: current.receipt,
					externalPresentation: current.externalPresentation,
					...(current.warningKind ? { warningKind: current.warningKind } : {}),
				},
			};
		}
	}
}

export function appendPendingHandoffPrompt(
	messages: ChatMessage[],
	sessionId: string | undefined,
	handoff: CloudHandoffUiEntry | undefined,
): ChatMessage[] {
	if (
		!sessionId ||
		(handoff?.status !== "progress" && handoff?.status !== "target_prompt") ||
		!handoff.pendingPrompt
	) {
		return messages;
	}
	const prompt = handoff.pendingPrompt;
	if (pendingHandoffPromptCaughtUp(messages, handoff)) return messages;

	const message: ChatMessage = {
		id: `handoff_prompt_${sessionId}_${prompt.submittedAt}`,
		sessionId,
		role: "user",
		content: prompt.content,
		images: prompt.images,
		createdAt: prompt.submittedAt,
		meta: { userRunSpan: 0 },
	};
	const baselineTailIndex = prompt.baselineTailMessageId
		? messages.findIndex(
				(existing) => existing.id === prompt.baselineTailMessageId,
			)
		: -1;
	const insertionIndex =
		baselineTailIndex >= 0
			? baselineTailIndex + 1
			: messages.findIndex(
					(existing) => existing.createdAt >= prompt.submittedAt,
				);
	if (insertionIndex < 0) return [...messages, message];
	return [
		...messages.slice(0, insertionIndex),
		message,
		...messages.slice(insertionIndex),
	];
}

export function pendingHandoffPromptCaughtUp(
	messages: ChatMessage[],
	handoff: CloudHandoffUiEntry | undefined,
): boolean {
	if (handoff?.status !== "target_prompt") return false;
	const baselineTailIndex = handoff.pendingPrompt.baselineTailMessageId
		? messages.findIndex(
				(message) => message.id === handoff.pendingPrompt.baselineTailMessageId,
			)
		: -1;
	if (baselineTailIndex >= 0) {
		const messagesAfterSeed = messages.slice(baselineTailIndex + 1);
		const firstResponseIndex = messagesAfterSeed.findIndex(
			(message) => message.role === "assistant",
		);
		const messagesBeforeResponse =
			firstResponseIndex >= 0
				? messagesAfterSeed.slice(0, firstResponseIndex)
				: messagesAfterSeed;
		return (
			matchingUserPromptCount(
				messagesBeforeResponse,
				handoff.pendingPrompt.content,
			) > 0
		);
	}
	return (
		matchingUserPromptCount(messages, handoff.pendingPrompt.content) >
		handoff.pendingPrompt.baselineOccurrences
	);
}

export function matchingUserPromptCount(
	messages: ChatMessage[],
	prompt: string,
): number {
	const expected = formatDisplayUserInput(prompt);
	return messages.filter(
		(message) =>
			message.role === "user" &&
			!message.id.startsWith("user_") &&
			formatDisplayUserInput(message.content) === expected,
	).length;
}
