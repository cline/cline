import {
	formatDisplayUserInput,
	type HubEventEnvelope,
	type MessageWithMetadata,
} from "@cline/shared";
import type { CloudSessionState, JsonRecord } from "./types";

export function immutableCopy<T>(value: T): T {
	const copy = structuredClone(value);
	const freeze = (item: unknown): void => {
		if (!item || typeof item !== "object" || Object.isFrozen(item)) return;
		for (const child of Object.values(item)) freeze(child);
		Object.freeze(item);
	};
	freeze(copy);
	return copy;
}

export function normalizeSessionTitle(
	title?: string | null,
): string | undefined {
	const trimmed = title?.trim();
	return trimmed ? formatDisplayUserInput(trimmed).slice(0, 120) : undefined;
}

export function stringifyMessageContent(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		const parts: string[] = [];
		for (const block of value) {
			if (typeof block === "string") {
				if (block.trim()) {
					parts.push(block);
				}
				continue;
			}
			if (!block || typeof block !== "object") {
				continue;
			}
			const record = block as JsonRecord;
			const blockType = typeof record.type === "string" ? record.type : "";
			const piece =
				blockType === "text"
					? String(record.text ?? "")
					: blockType === "thinking"
						? String(record.thinking ?? "")
						: blockType === "tool_use"
							? `[tool] ${String(record.name ?? "tool_call")}`
							: blockType === "tool_result"
								? `[tool_result]\n${stringifyMessageContent(record.content)}`
								: blockType === "image"
									? "[image]"
									: blockType === "redacted_thinking"
										? "[redacted_thinking]"
										: typeof record.text === "string"
											? record.text
											: "";
			if (piece.trim()) {
				parts.push(piece);
			}
		}
		return parts.join("\n");
	}
	if (value && typeof value === "object") {
		const record = value as JsonRecord;
		if (typeof record.text === "string") {
			return record.text;
		}
	}
	return "";
}

function titleFromPrompt(prompt?: string | null): string | undefined {
	const normalized = normalizeSessionTitle(prompt ?? undefined);
	if (!normalized) {
		return undefined;
	}
	return normalized.split("\n")[0]?.trim().slice(0, 70) || undefined;
}

function titleFromMessages(messages: unknown[]): string | undefined {
	for (const role of ["user", "assistant"] as const) {
		for (const rawMessage of messages) {
			if (!rawMessage || typeof rawMessage !== "object") {
				continue;
			}
			const message = rawMessage as JsonRecord;
			if (message.role !== role) {
				continue;
			}
			const text = normalizeSessionTitle(
				stringifyMessageContent(message.content),
			);
			if (!text) {
				continue;
			}
			return text.split("\n")[0]?.trim().slice(0, 70) || undefined;
		}
	}
	return undefined;
}

export function resolveSessionListTitle(options: {
	sessionId: string;
	metadata?: unknown;
	prompt?: string | null;
	messages?: unknown[];
}): string {
	const metadataTitle =
		options.metadata && typeof options.metadata === "object"
			? normalizeSessionTitle(
					(options.metadata as JsonRecord).title as string | undefined,
				)
			: undefined;
	if (metadataTitle) {
		return metadataTitle.slice(0, 70);
	}
	const promptTitle = titleFromPrompt(options.prompt);
	if (promptTitle) {
		return promptTitle;
	}
	const messageTitle = options.messages
		? titleFromMessages(options.messages)
		: undefined;
	if (messageTitle) {
		return messageTitle;
	}
	return `Session ${options.sessionId.slice(-6)}`;
}

/** Mutates only controller-owned state. Hosts receive frozen copies afterwards. */
export function reduceCloudEvent(
	state: CloudSessionState,
	event: HubEventEnvelope,
	streams: Map<string, number>,
	sessionId: string,
): void {
	const payload = event.payload ?? {};
	const assistant = (): JsonRecord[] => {
		let index = streams.get(sessionId);
		if (
			index === undefined ||
			!state.messages[index] ||
			state.messages[index]?.role !== "assistant"
		) {
			index = state.messages.length;
			state.messages.push({
				role: "assistant",
				content: [],
			} as MessageWithMetadata);
			streams.set(sessionId, index);
		}
		const message = state.messages[index]!;
		if (!Array.isArray(message.content)) message.content = [];
		return message.content as unknown as JsonRecord[];
	};
	const appendText = (type: string, key: string, text: string) => {
		const content = assistant();
		const last = content.at(-1);
		if (last?.type === type) last[key] = `${last[key] ?? ""}${text}`;
		else content.push({ type, [key]: text });
	};
	switch (event.event) {
		case "assistant.delta":
			if (typeof payload.text === "string")
				appendText("text", "text", payload.text);
			return;
		case "reasoning.delta":
			if (typeof payload.text === "string" && payload.text)
				appendText("thinking", "thinking", payload.text);
			else if (payload.redacted === true)
				assistant().push({ type: "redacted_thinking", data: "" });
			return;
		case "assistant.finished":
			streams.delete(sessionId);
			return;
		case "assistant.media":
			if (payload.media)
				assistant().push({
					type: "media",
					media: structuredClone(payload.media),
				});
			return;
		case "tool.started": {
			const id = String(payload.toolCallId ?? "");
			if (
				id &&
				!state.messages.some(
					(message) =>
						Array.isArray(message.content) &&
						message.content.some(
							(part) => part.type === "tool_use" && part.id === id,
						),
				)
			) {
				assistant().push({
					type: "tool_use",
					id,
					name: String(payload.toolName ?? "tool"),
					input: structuredClone(payload.input ?? {}),
				});
			}
			return;
		}
		case "tool.finished": {
			const id = String(payload.toolCallId ?? "");
			if (
				id &&
				!state.messages.some(
					(message) =>
						Array.isArray(message.content) &&
						message.content.some(
							(part) => part.type === "tool_result" && part.tool_use_id === id,
						),
				)
			) {
				state.messages.push({
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: id,
							content:
								typeof payload.output === "string"
									? payload.output
									: JSON.stringify(payload.output ?? ""),
							is_error: Boolean(payload.error),
						},
					],
				} as MessageWithMetadata);
				streams.delete(sessionId);
			}
			return;
		}
		case "usage.updated":
			state.usage = structuredClone(
				(payload.totals ?? payload.delta ?? {}) as JsonRecord,
			);
			return;
		case "session.pending_prompts": {
			const prompts = Array.isArray(payload.prompts)
				? (payload.prompts as JsonRecord[])
				: [];
			state.promptsInQueue = prompts
				.map((item) => ({
					id: String(item.id ?? ""),
					prompt: String(item.prompt ?? ""),
					steer: item.delivery === "steer",
					attachmentCount:
						typeof item.attachmentCount === "number" ? item.attachmentCount : 0,
					userImages: Array.isArray(item.userImages)
						? item.userImages.filter(
								(value): value is string => typeof value === "string",
							)
						: undefined,
				}))
				.filter((item) => item.id && (item.prompt || item.attachmentCount));
			return;
		}
		case "session.pending_prompt_submitted": {
			const prompt = payload.prompt as JsonRecord | undefined;
			const id = String(prompt?.id ?? "");
			if (!id || state.lastQueuedPromptStartId === id) return;
			state.lastQueuedPromptStartId = id;
			state.promptsInQueue = state.promptsInQueue.filter(
				(item) => item.id !== id,
			);
			if (payload.transcriptReflected !== true)
				state.messages.push({
					role: "user",
					content: [{ type: "text", text: String(prompt?.prompt ?? "") }],
				} as MessageWithMetadata);
			state.busy = true;
			state.status = "running";
			state.endedAt = undefined;
			streams.delete(sessionId);
			return;
		}
		case "run.started":
		case "session.attached":
		case "session.updated": {
			if (
				typeof event.sequence === "number" &&
				state.lastHubStatusSequence !== undefined &&
				event.sequence < state.lastHubStatusSequence
			)
				return;
			if (typeof event.sequence === "number")
				state.lastHubStatusSequence = event.sequence;
			const session = payload.session as JsonRecord | undefined;
			const raw =
				typeof session?.status === "string"
					? session.status
					: event.event === "run.started"
						? "running"
						: state.status;
			const status = raw === "pending" ? "running" : raw;
			if (
				event.event === "session.updated" &&
				status === "running" &&
				state.endedAt !== undefined &&
				!state.busy
			)
				return;
			const alreadyRunning = state.busy;
			state.status = status;
			state.busy = status === "running";
			if (event.event === "run.started") {
				// Queue/steer acknowledgements are not a new assistant turn.
				if (!alreadyRunning) streams.delete(sessionId);
				state.endedAt = undefined;
			}
			return;
		}
		case "run.completed":
		case "run.failed":
		case "run.aborted": {
			if (
				typeof event.sequence === "number" &&
				state.lastHubStatusSequence !== undefined &&
				event.sequence < state.lastHubStatusSequence
			)
				return;
			if (typeof event.sequence === "number")
				state.lastHubStatusSequence = event.sequence;
			state.status =
				typeof payload.reason === "string"
					? payload.reason
					: event.event === "run.failed"
						? "error"
						: event.event === "run.aborted"
							? "aborted"
							: "completed";
			state.busy = false;
			state.endedAt = Date.now();
			streams.delete(sessionId);
			return;
		}
	}
}
