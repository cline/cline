"use client";

import { nanoid } from "nanoid";
import type { MutableRefObject } from "react";
import type {
	WebviewChatAttachments,
	WebviewChatMessage,
	WebviewChatMessageBlock,
	WebviewToolEvent,
} from "../../webview-protocol";

export type ChatMessage = WebviewChatMessage;
export type ChatMessageBlock = WebviewChatMessageBlock;
export type ToolEvent = NonNullable<WebviewChatMessage["toolEvents"]>[number];

export function createMessage(
	role: ChatMessage["role"],
	text: string,
	extra?: Partial<ChatMessage>,
): ChatMessage {
	return {
		id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
		role,
		text,
		...extra,
	};
}

export function buildUserMessageLabel(
	prompt: string,
	attachments?: WebviewChatAttachments,
	attachmentCount = 0,
): string {
	const resolvedCount =
		attachmentCount || (attachments?.userImages?.length ?? 0);
	if (resolvedCount === 0) {
		return prompt;
	}
	return `${prompt}${prompt.length > 0 ? "\n\n" : ""}[attached ${resolvedCount} file${resolvedCount === 1 ? "" : "s"}]`;
}

export function appendAssistantDelta(
	current: ChatMessage[],
	text: string,
	activeAssistantIdRef: MutableRefObject<string | undefined>,
): ChatMessage[] {
	if (!text) {
		return current;
	}

	const activeAssistantId = activeAssistantIdRef.current;
	if (activeAssistantId) {
		const targetIndex = current.findIndex(
			(message) => message.id === activeAssistantId,
		);
		if (targetIndex >= 0) {
			return current.map((message, index) =>
				index === targetIndex
					? {
							...message,
							text: `${message.text}${text}`,
							blocks: appendTextBlock(message.blocks, text),
						}
					: message,
			);
		}
	}

	const lastMessage = current.at(-1);
	if (lastMessage?.role === "assistant") {
		activeAssistantIdRef.current = lastMessage.id;
		return [
			...current.slice(0, -1),
			{
				...lastMessage,
				text: `${lastMessage.text}${text}`,
				blocks: appendTextBlock(lastMessage.blocks, text),
			},
		];
	}

	const assistantMessage = createMessage("assistant", text, {
		blocks: [{ id: nanoid(), type: "text", text }],
	});
	activeAssistantIdRef.current = assistantMessage.id;
	return [...current, assistantMessage];
}

export function appendTextBlock(
	blocks: ChatMessageBlock[] | undefined,
	text: string,
): ChatMessageBlock[] {
	const current = blocks ?? [];
	const last = current.at(-1);
	if (last?.type === "text") {
		return current.map((block, index) =>
			index === current.length - 1 && block.type === "text"
				? { ...block, text: `${block.text}${text}` }
				: block,
		);
	}
	return [...current, { id: nanoid(), type: "text", text }];
}

export function appendReasoningBlock(
	blocks: ChatMessageBlock[] | undefined,
	text: string,
	redacted?: boolean,
): ChatMessageBlock[] {
	const current = blocks ?? [];
	const last = current.at(-1);
	if (last?.type === "reasoning") {
		return current.map((block, index) =>
			index === current.length - 1 && block.type === "reasoning"
				? {
						...block,
						text: `${block.text}${text}`,
						redacted: block.redacted || redacted,
					}
				: block,
		);
	}
	return [...current, { id: nanoid(), type: "reasoning", text, redacted }];
}

export function upsertToolBlock(
	blocks: ChatMessageBlock[] | undefined,
	toolEvent: ToolEvent,
): ChatMessageBlock[] {
	const current = blocks ?? [];
	const existingIndex = current.findIndex(
		(block) =>
			block.type === "tool" &&
			((block.toolEvent.toolCallId &&
				toolEvent.toolCallId &&
				block.toolEvent.toolCallId === toolEvent.toolCallId) ||
				(!block.toolEvent.toolCallId &&
					!toolEvent.toolCallId &&
					block.toolEvent.name === toolEvent.name &&
					block.toolEvent.state === "input-available" &&
					toolEvent.state !== "input-available")),
	);
	if (existingIndex === -1) {
		return [...current, { id: nanoid(), type: "tool", toolEvent }];
	}
	return current.map((block, index) =>
		index === existingIndex && block.type === "tool"
			? { ...block, toolEvent: { ...block.toolEvent, ...toolEvent } }
			: block,
	);
}

export function appendReasoningDelta(
	current: ChatMessage[],
	text: string,
	redacted: boolean | undefined,
	activeAssistantIdRef: MutableRefObject<string | undefined>,
): ChatMessage[] {
	const reasoningChunk = text || (redacted ? "[redacted]" : "");
	if (!reasoningChunk) {
		return current;
	}

	const activeAssistantId = activeAssistantIdRef.current;
	if (activeAssistantId) {
		const targetIndex = current.findIndex(
			(message) => message.id === activeAssistantId,
		);
		if (targetIndex >= 0) {
			return current.map((message, index) =>
				index === targetIndex
					? {
							...message,
							reasoning: `${message.reasoning ?? ""}${reasoningChunk}`,
							reasoningRedacted: message.reasoningRedacted || redacted,
							blocks: appendReasoningBlock(
								message.blocks,
								reasoningChunk,
								redacted,
							),
						}
					: message,
			);
		}
	}

	const lastMessage = current.at(-1);
	if (lastMessage?.role === "assistant") {
		activeAssistantIdRef.current = lastMessage.id;
		return [
			...current.slice(0, -1),
			{
				...lastMessage,
				reasoning: `${lastMessage.reasoning ?? ""}${reasoningChunk}`,
				reasoningRedacted: lastMessage.reasoningRedacted || redacted,
				blocks: appendReasoningBlock(
					lastMessage.blocks,
					reasoningChunk,
					redacted,
				),
			},
		];
	}

	const assistantMessage = createMessage("assistant", "", {
		reasoning: reasoningChunk,
		reasoningRedacted: redacted,
		blocks: [
			{ id: nanoid(), type: "reasoning", text: reasoningChunk, redacted },
		],
	});
	activeAssistantIdRef.current = assistantMessage.id;
	return [...current, assistantMessage];
}

export function extractToolName(text: string): string {
	const runningMatch = /^Running (.+)\.\.\.$/.exec(text);
	if (runningMatch?.[1]) {
		return runningMatch[1];
	}
	const terminalMatch = /^(.+?) (completed|failed:.*)$/.exec(text);
	return terminalMatch?.[1] ?? "tool";
}

export function deriveToolState(text: string): ToolEvent["state"] {
	if (text.includes("failed:")) {
		return "output-error";
	}
	if (text.endsWith("completed")) {
		return "output-available";
	}
	return "input-available";
}

export function mapToolEventState(
	event?: WebviewToolEvent,
	fallbackText?: string,
): ToolEvent["state"] {
	if (event?.status === "failed") {
		return "output-error";
	}
	if (event?.status === "completed") {
		return "output-available";
	}
	if (event?.status === "running") {
		return "input-available";
	}
	return deriveToolState(fallbackText ?? "");
}

export function upsertToolEvent(
	events: ToolEvent[],
	next: ToolEvent,
): ToolEvent[] {
	const existingIndex = events.findIndex(
		(event) =>
			(event.toolCallId &&
				next.toolCallId &&
				event.toolCallId === next.toolCallId) ||
			(!event.toolCallId &&
				!next.toolCallId &&
				event.name === next.name &&
				event.state === "input-available" &&
				next.state !== "input-available"),
	);

	if (existingIndex === -1) {
		return [...events, next];
	}

	return events.map((event, index) =>
		index === existingIndex
			? {
					...event,
					text: next.text,
					state: next.state,
					output: next.output,
					error: next.error,
				}
			: event,
	);
}

export function appendToolEvent(
	current: ChatMessage[],
	text: string,
	event: WebviewToolEvent | undefined,
	activeAssistantIdRef: MutableRefObject<string | undefined>,
): ChatMessage[] {
	const activeAssistantId = activeAssistantIdRef.current;
	const toolEvent: ToolEvent = {
		id: nanoid(),
		toolCallId: event?.toolCallId,
		name: event?.toolName ?? extractToolName(text),
		state: mapToolEventState(event, text),
		text,
		input: event?.input,
		output: event?.output,
		error: event?.error,
	};

	if (activeAssistantId) {
		return current.map((message) =>
			message.id === activeAssistantId
				? {
						...message,
						toolEvents: upsertToolEvent(message.toolEvents ?? [], toolEvent),
						blocks: upsertToolBlock(message.blocks, toolEvent),
					}
				: message,
		);
	}

	return [
		...current,
		createMessage("meta", text, {
			toolEvents: [toolEvent],
			blocks: [{ id: nanoid(), type: "tool", toolEvent }],
		}),
	];
}

export function mergeHydratedMessagesWithLive(
	hydrated: ChatMessage[],
	current: ChatMessage[],
): ChatMessage[] {
	if (current.length === 0) {
		return hydrated;
	}
	const next = [...hydrated];
	for (const live of current) {
		const last = next.at(-1);
		if (live.role === "assistant" && last?.role === "assistant") {
			next[next.length - 1] = {
				...last,
				text: `${last.text}${live.text}`,
				reasoning:
					`${last.reasoning ?? ""}${live.reasoning ?? ""}` || undefined,
				reasoningRedacted:
					last.reasoningRedacted || live.reasoningRedacted || undefined,
				toolEvents: [...(last.toolEvents ?? []), ...(live.toolEvents ?? [])],
				blocks: [...(last.blocks ?? []), ...(live.blocks ?? [])],
			};
			continue;
		}
		if (
			live.role === "meta" &&
			last?.role === "meta" &&
			(live.toolEvents?.length ?? 0) > 0
		) {
			next[next.length - 1] = {
				...last,
				text: live.text || last.text,
				toolEvents: [...(last.toolEvents ?? []), ...(live.toolEvents ?? [])],
				blocks: [...(last.blocks ?? []), ...(live.blocks ?? [])],
			};
			continue;
		}
		next.push(live);
	}
	return next;
}

export function finalizeAssistantTurn(
	current: ChatMessage[],
	finishReason: string,
	iterations: number,
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
	},
): ChatMessage[] {
	return [
		...current,
		createMessage(
			"meta",
			`Done (${finishReason}) • iterations=${iterations} • input=${usage?.inputTokens ?? 0} output=${usage?.outputTokens ?? 0}`,
		),
	];
}
