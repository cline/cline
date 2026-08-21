import { formatDisplayUserInput } from "@cline/shared/browser";
import type { ChatMessage } from "@/lib/chat-schema";
import type { HandoffProgressPhase, HandoffReceipt } from "@/lib/cloud-handoff";

export type PendingHandoffPrompt = {
	content: string;
	submittedAt: number;
	baselineMessageIds: string[];
	images?: ChatMessage["images"];
};

export type CloudHandoffUiEntry =
	| {
			status: "progress";
			phase: HandoffProgressPhase;
			message?: string;
			dashboardUrl?: string;
			pendingPrompt?: PendingHandoffPrompt;
			retry?: true;
	  }
	| {
			status: "recovery";
			dashboardUrl: string;
			retryDraft?: string;
			retryAttachments?: File[];
			pendingPrompt?: PendingHandoffPrompt;
			retry?: true;
	  }
	| { status: "recovery_dismissed"; dashboardUrl: string }
	| {
			status: "failed";
			retryDraft?: string;
			retryAttachments?: File[];
			pendingPrompt?: PendingHandoffPrompt;
			retry?: true;
	  }
	| {
			status: "retry_restored";
			pendingPrompt?: PendingHandoffPrompt;
			retry?: true;
	  }
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
			pendingPrompt: PendingHandoffPrompt | undefined;
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
	pendingPrompt: PendingHandoffPrompt | undefined,
): CloudHandoffUiState {
	const current = state[sourceSessionId];
	const next: CloudHandoffUiState = {
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
	if (
		current?.status === "complete" &&
		next[current.receipt.targetSessionId]?.status === "target_prompt" &&
		(current.receipt.targetSessionId !== receipt.targetSessionId ||
			externalPresentation ||
			!pendingPrompt)
	) {
		delete next[current.receipt.targetSessionId];
	}
	return next;
}

export function cloudHandoffUiReducer(
	state: CloudHandoffUiState,
	action: CloudHandoffUiAction,
): CloudHandoffUiState {
	const current = state[action.sourceSessionId];
	switch (action.type) {
		case "start": {
			const retry =
				current?.status === "failed" ||
				current?.status === "recovery" ||
				current?.status === "retry_restored";
			return {
				...state,
				[action.sourceSessionId]: {
					status: "progress",
					phase: "checking",
					...(action.pendingPrompt
						? { pendingPrompt: action.pendingPrompt }
						: {}),
					...(retry ? { retry: true as const } : {}),
				},
			};
		}
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
			if (current?.status === "complete") return state;
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
					current?.status === "progress" ||
						current?.status === "failed" ||
						current?.status === "recovery" ||
						current?.status === "retry_restored"
						? current.retry
							? undefined
							: current.pendingPrompt
						: undefined,
				);
			}
			if (
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
					retry: current?.status === "progress" ? current.retry : undefined,
				},
			};
		case "failed": {
			if (current?.status === "complete") return state;
			const dashboardUrl =
				current?.status === "progress" ? current.dashboardUrl : undefined;
			const pendingPrompt =
				current?.status === "progress" ||
				current?.status === "failed" ||
				current?.status === "recovery"
					? current.pendingPrompt
					: undefined;
			const retry =
				current?.status === "progress" ||
				current?.status === "failed" ||
				current?.status === "recovery"
					? current.retry
					: undefined;
			if (action.exposeRecovery && dashboardUrl) {
				return {
					...state,
					[action.sourceSessionId]: {
						status: "recovery",
						dashboardUrl,
						retryDraft: action.retryDraft,
						retryAttachments: action.retryAttachments,
						...(pendingPrompt ? { pendingPrompt } : {}),
						...(retry ? { retry } : {}),
					},
				};
			}
			return {
				...state,
				[action.sourceSessionId]: {
					status: "failed",
					retryDraft: action.retryDraft,
					retryAttachments: action.retryAttachments,
					...(pendingPrompt ? { pendingPrompt } : {}),
					...(retry ? { retry } : {}),
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
					[action.sourceSessionId]: {
						status: "retry_restored",
						...(current.pendingPrompt
							? { pendingPrompt: current.pendingPrompt }
							: {}),
						...(current.retry ? { retry: current.retry } : {}),
					},
				};
			}
			if (current?.status === "recovery") {
				return {
					...state,
					[action.sourceSessionId]: {
						status: "recovery",
						dashboardUrl: current.dashboardUrl,
						...(current.pendingPrompt
							? { pendingPrompt: current.pendingPrompt }
							: {}),
						...(current.retry ? { retry: current.retry } : {}),
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
	const baselineIds = new Set(handoff.pendingPrompt.baselineMessageIds);
	const matchingMessages = matchingHandoffPromptMessages(
		messages,
		handoff.pendingPrompt.content,
	);
	return (
		matchingMessages.length > baselineIds.size ||
		matchingMessages.some(
			(message) =>
				!baselineIds.has(message.id) &&
				message.createdAt >= handoff.pendingPrompt.submittedAt,
		)
	);
}

export function matchingHandoffPromptMessageIds(
	messages: ChatMessage[],
	prompt: string,
): string[] {
	return matchingHandoffPromptMessages(messages, prompt).map(
		(message) => message.id,
	);
}

function matchingHandoffPromptMessages(
	messages: ChatMessage[],
	prompt: string,
): ChatMessage[] {
	const expected = formatDisplayUserInput(prompt);
	return messages.filter(
		(message) =>
			message.role === "user" &&
			formatDisplayUserInput(message.content) === expected,
	);
}
