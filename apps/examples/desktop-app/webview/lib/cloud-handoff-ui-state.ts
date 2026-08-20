import type { ChatMessage } from "@/lib/chat-schema";
import type { HandoffProgressPhase, HandoffReceipt } from "@/lib/cloud-handoff";

type PendingHandoffPrompt = {
	content: string;
	submittedAt: number;
	occurrence: number;
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
			type: "prompt_images";
			sourceSessionId: string;
			images: NonNullable<ChatMessage["images"]>;
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
): CloudHandoffUiState {
	const current = state[sourceSessionId];
	return {
		...state,
		[sourceSessionId]: { status: "complete", receipt, externalPresentation },
		...(!externalPresentation &&
		current?.status === "progress" &&
		current.pendingPrompt
			? {
					[receipt.targetSessionId]: {
						status: "target_prompt" as const,
						pendingPrompt: current.pendingPrompt,
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
		case "start":
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
		case "prompt_images":
			if (current?.status !== "progress" || !current.pendingPrompt) {
				return state;
			}
			return {
				...state,
				[action.sourceSessionId]: {
					...current,
					pendingPrompt: {
						...current.pendingPrompt,
						images: action.images,
					},
				},
			};
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
			);
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
	sourceSessionId: string | undefined,
	handoff: CloudHandoffUiEntry | undefined,
): ChatMessage[] {
	if (
		!sourceSessionId ||
		(handoff?.status !== "progress" && handoff?.status !== "target_prompt")
	) {
		return messages;
	}
	const prompt = handoff.pendingPrompt;
	if (!prompt) return messages;
	if (pendingHandoffPromptCaughtUp(messages, handoff)) return messages;

	const id = `handoff_prompt_${sourceSessionId}_${prompt.submittedAt}`;
	if (messages.some((message) => message.id === id)) return messages;
	return [
		...messages,
		{
			id,
			sessionId: sourceSessionId,
			role: "user",
			content: prompt.content,
			images: prompt.images,
			createdAt: prompt.submittedAt,
			meta: { userRunSpan: 0 },
		},
	];
}

export function pendingHandoffPromptCaughtUp(
	messages: ChatMessage[],
	handoff: CloudHandoffUiEntry | undefined,
): boolean {
	if (handoff?.status !== "target_prompt") return false;
	const expected = handoff.pendingPrompt.content.trim();
	return (
		messages.filter(
			(message) =>
				message.role === "user" && message.content.trim() === expected,
		).length >= handoff.pendingPrompt.occurrence
	);
}
