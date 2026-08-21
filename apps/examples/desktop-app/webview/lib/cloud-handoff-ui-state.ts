import { formatDisplayUserInput } from "@cline/shared/browser";
import type { ChatMessage } from "@/lib/chat-schema";
import type { HandoffProgressPhase, HandoffReceipt } from "@/lib/cloud-handoff";

export type PendingHandoffPrompt = {
	content: string;
	submittedAt: number;
	baselineOccurrences: number;
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
	| { status: "recovery_dismissed"; dashboardUrl: string }
	| { status: "failed"; retryDraft?: string; retryAttachments?: File[] }
	| { status: "retry_restored" }
	| { status: "target_prompt"; pendingPrompt: PendingHandoffPrompt }
	| {
			status: "complete";
			receipt: HandoffReceipt;
			externalPresentation: boolean;
	  };

export type CloudHandoffUiState = Record<string, CloudHandoffUiEntry>;

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
	  }
	| { type: "external"; sourceSessionId: string }
	| { type: "prompt_reconciled"; sourceSessionId: string }
	| {
			type: "dismiss_recovery";
			sourceSessionId: string;
			dashboardUrl: string;
	  }
	| { type: "retry_restored"; sourceSessionId: string };

function completeHandoff(
	state: CloudHandoffUiState,
	sourceSessionId: string,
	receipt: HandoffReceipt,
	externalPresentation: boolean,
	pendingPrompt?: PendingHandoffPrompt,
): CloudHandoffUiState {
	return {
		...state,
		[sourceSessionId]: {
			status: "complete",
			receipt,
			externalPresentation,
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
			return {
				...state,
				[action.sourceSessionId]: {
					status: "progress",
					phase: "checking",
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
			);
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
				},
			};
		case "retry_restored":
			if (current?.status === "failed") {
				return {
					...state,
					[action.sourceSessionId]: { status: "retry_restored" },
				};
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
	const insertionIndex = messages.findIndex(
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
			formatDisplayUserInput(message.content) === expected,
	).length;
}
