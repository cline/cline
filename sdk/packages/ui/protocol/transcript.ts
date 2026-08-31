import type {
	UiDefaults,
	UiModelInfo,
	UiOutboundMessage,
	UiPendingPrompt,
	UiProviderInfo,
	UiSessionSummary,
	UiUsage,
} from "@cline/shared";

/**
 * Renderer-independent semantic model of a UI-protocol conversation. Both
 * browser hosts and the terminal client can fold `UiOutboundMessage`s into
 * this state instead of re-implementing streaming accumulation per renderer.
 */

export type UiTranscriptBlock =
	| { kind: "user"; text: string }
	| { kind: "assistant_text"; text: string; streaming: boolean }
	| {
			kind: "reasoning";
			text: string;
			streaming: boolean;
			redacted?: boolean;
	  }
	| {
			kind: "tool";
			toolCallId?: string;
			toolName: string;
			status: "running" | "completed" | "failed";
			text: string;
			input?: unknown;
			output?: unknown;
			error?: string;
	  }
	| {
			kind: "media";
			mediaType: string;
			modality: "image" | "audio" | "video" | "file";
			sizeBytes?: number;
	  }
	| { kind: "status"; text: string }
	| { kind: "error"; text: string; recoverable?: boolean }
	| {
			kind: "turn_done";
			finishReason: string;
			iterations: number;
			usage?: UiUsage;
	  };

export interface UiTranscriptState {
	sessionId?: string;
	status?: string;
	blocks: UiTranscriptBlock[];
	running: boolean;
	defaults?: UiDefaults;
	providers: UiProviderInfo[];
	modelsByProvider: Record<string, UiModelInfo[]>;
	sessions: UiSessionSummary[];
	pendingPrompts: UiPendingPrompt[];
	lastTurn?: { finishReason: string; iterations: number; usage?: UiUsage };
}

export function createUiTranscriptState(): UiTranscriptState {
	return {
		blocks: [],
		running: false,
		providers: [],
		modelsByProvider: {},
		sessions: [],
		pendingPrompts: [],
	};
}

function closeStreamingBlocks(
	blocks: UiTranscriptBlock[],
): UiTranscriptBlock[] {
	return blocks.map((block) =>
		(block.kind === "assistant_text" || block.kind === "reasoning") &&
		block.streaming
			? { ...block, streaming: false }
			: block,
	);
}

/** Record a locally-submitted prompt (hosts echo nothing back for `send`). */
export function appendUserPrompt(
	state: UiTranscriptState,
	prompt: string,
): UiTranscriptState {
	return {
		...state,
		running: true,
		blocks: [
			...closeStreamingBlocks(state.blocks),
			{ kind: "user", text: prompt },
		],
	};
}

/** Fold one host message into the transcript state. */
export function reduceUiMessage(
	state: UiTranscriptState,
	message: UiOutboundMessage,
): UiTranscriptState {
	switch (message.type) {
		case "status":
			return {
				...state,
				status: message.text,
				blocks: [
					...closeStreamingBlocks(state.blocks),
					{ kind: "status", text: message.text },
				],
			};
		case "error": {
			const next: UiTranscriptState = {
				...state,
				blocks: [
					...closeStreamingBlocks(state.blocks),
					{
						kind: "error",
						text: message.text,
						recoverable: message.recoverable,
					},
				],
			};
			if (!message.recoverable) {
				next.running = false;
			}
			return next;
		}
		case "session_started":
			return { ...state, sessionId: message.sessionId };
		case "session_hydrated": {
			const blocks: UiTranscriptBlock[] = [];
			for (const chat of message.messages) {
				if (chat.role === "user") {
					blocks.push({ kind: "user", text: chat.text });
					continue;
				}
				if (chat.role === "error") {
					blocks.push({ kind: "error", text: chat.text });
					continue;
				}
				if (chat.role === "meta") {
					blocks.push({ kind: "status", text: chat.text });
					continue;
				}
				if (chat.reasoning) {
					blocks.push({
						kind: "reasoning",
						text: chat.reasoning,
						streaming: false,
						redacted: chat.reasoningRedacted,
					});
				}
				for (const tool of chat.toolEvents ?? []) {
					blocks.push({
						kind: "tool",
						toolCallId: tool.toolCallId,
						toolName: tool.name,
						status:
							tool.state === "output-error"
								? "failed"
								: tool.state === "output-available"
									? "completed"
									: "running",
						text: tool.text,
						input: tool.input,
						output: tool.output,
						error: tool.error,
					});
				}
				if (chat.text) {
					blocks.push({
						kind: "assistant_text",
						text: chat.text,
						streaming: false,
					});
				}
			}
			return {
				...state,
				sessionId: message.sessionId,
				status: message.status ?? state.status,
				blocks,
			};
		}
		case "session_ended":
			return { ...state, running: false, status: "ended" };
		case "assistant_delta": {
			const blocks = [...state.blocks];
			const last = blocks[blocks.length - 1];
			if (last && last.kind === "assistant_text" && last.streaming) {
				blocks[blocks.length - 1] = {
					...last,
					text: last.text + message.text,
				};
			} else {
				blocks.push({
					kind: "assistant_text",
					text: message.text,
					streaming: true,
				});
			}
			return {
				...state,
				running: true,
				blocks: closeOtherStreams(blocks, "assistant_text"),
			};
		}
		case "reasoning_delta": {
			const chunk =
				message.redacted && !message.text ? "[redacted]" : message.text;
			const blocks = [...state.blocks];
			const last = blocks[blocks.length - 1];
			if (last && last.kind === "reasoning" && last.streaming) {
				blocks[blocks.length - 1] = {
					...last,
					text: last.text + chunk,
					redacted: last.redacted || message.redacted,
				};
			} else {
				blocks.push({
					kind: "reasoning",
					text: chunk,
					streaming: true,
					redacted: message.redacted,
				});
			}
			return {
				...state,
				running: true,
				blocks: closeOtherStreams(blocks, "reasoning"),
			};
		}
		case "assistant_media":
			return {
				...state,
				blocks: [
					...closeStreamingBlocks(state.blocks),
					{
						kind: "media",
						mediaType: message.media.mediaType,
						modality: message.media.modality,
						sizeBytes: message.media.sizeBytes,
					},
				],
			};
		case "tool_event": {
			const event = message.event;
			if (!event) {
				return {
					...state,
					blocks: [
						...closeStreamingBlocks(state.blocks),
						{ kind: "status", text: message.text },
					],
				};
			}
			const blocks = closeStreamingBlocks(state.blocks);
			const status = event.status;
			const index = event.toolCallId
				? blocks.findIndex(
						(block) =>
							block.kind === "tool" && block.toolCallId === event.toolCallId,
					)
				: -1;
			const toolBlock: UiTranscriptBlock = {
				kind: "tool",
				toolCallId: event.toolCallId,
				toolName: event.toolName ?? "tool",
				status,
				text: message.text,
				input: event.input,
				output: event.output,
				error: event.error,
			};
			if (index >= 0) {
				const merged = blocks[index];
				blocks[index] =
					merged?.kind === "tool"
						? {
								...merged,
								...toolBlock,
								input: toolBlock.input ?? merged.input,
							}
						: toolBlock;
			} else {
				blocks.push(toolBlock);
			}
			return { ...state, running: true, blocks };
		}
		case "turn_done":
			return {
				...state,
				running: false,
				blocks: [
					...closeStreamingBlocks(state.blocks),
					{
						kind: "turn_done",
						finishReason: message.finishReason,
						iterations: message.iterations,
						usage: message.usage,
					},
				],
				lastTurn: {
					finishReason: message.finishReason,
					iterations: message.iterations,
					usage: message.usage,
				},
			};
		case "providers":
			return { ...state, providers: message.providers };
		case "models":
			return {
				...state,
				modelsByProvider: {
					...state.modelsByProvider,
					[message.providerId]: message.models,
				},
			};
		case "sessions":
			return { ...state, sessions: message.sessions };
		case "defaults":
			return { ...state, defaults: message.defaults };
		case "reset_done":
			return {
				...createUiTranscriptState(),
				defaults: state.defaults,
				providers: state.providers,
				modelsByProvider: state.modelsByProvider,
			};
		case "pending_prompts":
			return { ...state, pendingPrompts: message.prompts };
		case "pending_prompt_submitted":
			return {
				...state,
				pendingPrompts: state.pendingPrompts.filter(
					(prompt) => prompt.id !== message.id,
				),
				blocks: [
					...closeStreamingBlocks(state.blocks),
					{ kind: "user", text: message.prompt },
				],
			};
		default:
			return state;
	}
}

function closeOtherStreams(
	blocks: UiTranscriptBlock[],
	keep: "assistant_text" | "reasoning",
): UiTranscriptBlock[] {
	const lastIndex = blocks.length - 1;
	return blocks.map((block, index) => {
		if (index === lastIndex) return block;
		if (
			(block.kind === "assistant_text" || block.kind === "reasoning") &&
			block.kind !== keep &&
			block.streaming
		) {
			return { ...block, streaming: false };
		}
		return block;
	});
}
