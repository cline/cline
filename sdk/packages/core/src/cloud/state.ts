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

function textContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (typeof block === "string") return block;
			if (!block || typeof block !== "object") return "";
			if (block.type === "text") return String(block.text ?? "");
			if (block.type === "thinking") return String(block.thinking ?? "");
			if (block.type === "tool_use")
				return `[tool] ${block.name ?? "tool_call"}`;
			if (block.type === "tool_result")
				return `[tool_result]\n${textContent(block.content)}`;
			if (block.type === "image") return "[image]";
			return "";
		})
		.filter(Boolean)
		.join("\n");
}
export function resolveSessionListTitle(input: {
	sessionId: string;
	metadata?: JsonRecord;
	prompt?: string;
	messages?: unknown[];
}): string {
	const normalize = (text: unknown) =>
		typeof text === "string" && text.trim()
			? formatDisplayUserInput(text.trim())
					.slice(0, 120)
					.split("\n")[0]
					?.trim()
					.slice(0, 70)
			: undefined;
	if (normalize(input.metadata?.title))
		return normalize(input.metadata?.title)!;
	if (normalize(input.prompt)) return normalize(input.prompt)!;
	for (const role of ["user", "assistant"])
		for (const message of input.messages ?? []) {
			if (
				message &&
				typeof message === "object" &&
				(message as JsonRecord).role === role
			) {
				const title = normalize(textContent((message as JsonRecord).content));
				if (title) return title;
			}
		}
	return `Session ${input.sessionId.slice(-6)}`;
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
			state.status = status;
			state.busy = status === "running";
			if (event.event === "run.started") {
				streams.delete(sessionId);
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
