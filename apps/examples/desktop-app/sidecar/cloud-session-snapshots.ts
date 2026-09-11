import type { HubEventEnvelope } from "@cline/shared";
import type { JsonRecord, PromptInQueue } from "./types";

export function readSessionRows(
	payload: Record<string, unknown> | undefined,
): JsonRecord[] {
	return Array.isArray(payload?.sessions)
		? payload.sessions.filter(
				(item): item is JsonRecord =>
					Boolean(item) && typeof item === "object" && !Array.isArray(item),
			)
		: [];
}

export function updatedAt(record: JsonRecord): number {
	const value = record.updatedAt;
	return typeof value === "number"
		? value
		: Date.parse(String(value ?? "")) || 0;
}

export function sessionRowModelId(record: JsonRecord | undefined): string {
	const metadata =
		record?.metadata && typeof record.metadata === "object"
			? (record.metadata as JsonRecord)
			: undefined;
	return String(metadata?.model ?? record?.model ?? "").trim();
}

export function isRootSessionRow(record: JsonRecord): boolean {
	const metadata =
		record.metadata && typeof record.metadata === "object"
			? (record.metadata as JsonRecord)
			: undefined;
	return !String(
		metadata?.parentSessionId ?? record.parentSessionId ?? "",
	).trim();
}

function messageText(
	message: unknown,
	kind: "text" | "thinking" = "text",
): string {
	if (!message || typeof message !== "object" || Array.isArray(message)) {
		return "";
	}
	const content = (message as JsonRecord).content;
	if (typeof content === "string") {
		return kind === "text" ? content.trim() : "";
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((part) =>
			part && typeof part === "object" && !Array.isArray(part)
				? kind === "thinking" &&
					(part as JsonRecord).type === "redacted_thinking"
					? "[redacted]"
					: String((part as JsonRecord)[kind] ?? "")
				: "",
		)
		.join("")
		.trim();
}

function normalizeUserPrompt(text: string): string {
	const trimmed = text.trim();
	const match = trimmed.match(/^<user_input\b[^>]*>([\s\S]*)<\/user_input>$/);
	return (match ? match[1] : trimmed).trim();
}

export function countPromptOccurrences(
	messages: unknown[],
	prompts: PromptInQueue[],
	prompt: string,
): number {
	const expected = normalizeUserPrompt(prompt);
	return (
		messages.filter(
			(message) =>
				Boolean(message) &&
				typeof message === "object" &&
				!Array.isArray(message) &&
				String((message as JsonRecord).role ?? "").toLowerCase() === "user" &&
				normalizeUserPrompt(messageText(message)) === expected,
		).length +
		prompts.filter((item) => normalizeUserPrompt(item.prompt) === expected)
			.length
	);
}

export function submittedPromptsFromEvents(
	events: HubEventEnvelope[],
): PromptInQueue[] {
	return events.flatMap((event) => {
		if (event.event !== "session.pending_prompt_submitted") return [];
		const prompt =
			event.payload?.prompt &&
			typeof event.payload.prompt === "object" &&
			!Array.isArray(event.payload.prompt)
				? (event.payload.prompt as JsonRecord)
				: undefined;
		const id = String(prompt?.id ?? "").trim();
		if (!id) return [];
		return [
			{
				id,
				prompt: String(prompt?.prompt ?? ""),
				steer: prompt?.delivery === "steer",
				attachmentCount:
					typeof prompt?.attachmentCount === "number"
						? prompt.attachmentCount
						: 0,
				userImages: Array.isArray(prompt?.userImages)
					? prompt.userImages.filter(
							(image): image is string => typeof image === "string",
						)
					: undefined,
			},
		];
	});
}

const TERMINAL_RUN_EVENTS = new Set([
	"run.completed",
	"run.aborted",
	"run.failed",
]);
const SUPERSEDABLE_CONTENT_EVENTS = new Set([
	"assistant.delta",
	"assistant.finished",
	"reasoning.delta",
	"reasoning.finished",
]);

function assistantTexts(
	messages: unknown[],
	kind: "text" | "thinking",
): string[] {
	return messages
		.filter(
			(message): message is JsonRecord =>
				Boolean(message) &&
				typeof message === "object" &&
				!Array.isArray(message) &&
				String((message as JsonRecord).role ?? "").toLowerCase() ===
					"assistant",
		)
		.map((message) => messageText(message, kind))
		.filter(Boolean);
}

function newlyPersistedAssistantTexts(
	snapshotMessages: unknown[],
	baselineMessages: unknown[],
	kind: "text" | "thinking" = "text",
): string[] {
	const baselineCounts = new Map<string, number>();
	for (const text of assistantTexts(baselineMessages, kind)) {
		baselineCounts.set(text, (baselineCounts.get(text) ?? 0) + 1);
	}
	return assistantTexts(snapshotMessages, kind).filter((text) => {
		const count = baselineCounts.get(text) ?? 0;
		if (count === 0) return true;
		if (count === 1) baselineCounts.delete(text);
		else baselineCounts.set(text, count - 1);
		return false;
	});
}

function collectToolCallIds(
	value: unknown,
	phase: "tool_use" | "tool_result",
	result = new Set<string>(),
): Set<string> {
	if (!value || typeof value !== "object") return result;
	if (Array.isArray(value)) {
		for (const item of value) collectToolCallIds(item, phase, result);
		return result;
	}
	const record = value as JsonRecord;
	const id = phase === "tool_use" ? record.id : record.tool_use_id;
	if (record.type === phase && typeof id === "string") {
		result.add(id);
	}
	for (const child of Object.values(record))
		collectToolCallIds(child, phase, result);
	return result;
}

function streamedAssistantText(
	events: HubEventEnvelope[],
	kind: "assistant" | "reasoning" = "assistant",
): string {
	let finishedText = "";
	let deltas = "";
	for (const event of events) {
		if (event.event === `${kind}.delta`) {
			deltas +=
				kind === "reasoning" && event.payload?.redacted && !event.payload?.text
					? "[redacted]"
					: typeof event.payload?.text === "string"
						? event.payload.text
						: "";
		} else if (event.event === `${kind}.finished`) {
			const text = event.payload?.[kind === "assistant" ? "text" : "reasoning"];
			const completed = typeof text === "string" && text ? text : deltas;
			if (completed) finishedText = completed;
			deltas = "";
		}
	}
	return (finishedText || deltas).trim();
}

/** Reconciles each completed run separately; tools dedupe by stable call id. */
export function reconcileBufferedCloudEvents(
	events: HubEventEnvelope[],
	snapshotMessages: unknown[],
	options: {
		/**
		 * Whether a fresh queue snapshot was fetched and applied during
		 * rehydration. When it was, queue events received before its reply are
		 * stale; later events still win. When the fetch failed, the newest
		 * buffered queue event is the best state available.
		 */
		queueSnapshotApplied?: boolean;
		queueSnapshotEventCutoff?: number;
		/** Events received after the transcript reply cannot be reflected in it. */
		messagesSnapshotEventCutoff?: number;
		baselineMessages?: unknown[];
	} = {},
): HubEventEnvelope[] {
	const queueSnapshotApplied = options.queueSnapshotApplied !== false;
	const unclaimedAssistantTexts = newlyPersistedAssistantTexts(
		snapshotMessages,
		options.baselineMessages ?? [],
	);
	const unclaimedThinking = newlyPersistedAssistantTexts(
		snapshotMessages,
		options.baselineMessages ?? [],
		"thinking",
	);
	const snapshotToolCallIds = collectToolCallIds(snapshotMessages, "tool_use");
	const snapshotToolResultIds = collectToolCallIds(
		snapshotMessages,
		"tool_result",
	);
	const beforeTranscript = new Set(
		events.slice(0, options.messagesSnapshotEventCutoff ?? events.length),
	);
	const reflectedSubmissions = new Set<HubEventEnvelope>();
	const unclaimedUserCounts = new Map<string, number>();
	for (const event of events.slice(
		0,
		options.messagesSnapshotEventCutoff ?? events.length,
	)) {
		const submitted = submittedPromptsFromEvents([event])[0];
		if (!submitted) continue;
		const prompt = normalizeUserPrompt(submitted.prompt);
		const count =
			unclaimedUserCounts.get(prompt) ??
			Math.max(
				0,
				countPromptOccurrences(snapshotMessages, [], prompt) -
					countPromptOccurrences(options.baselineMessages ?? [], [], prompt),
			);
		unclaimedUserCounts.set(prompt, Math.max(0, count - 1));
		if (count > 0) reflectedSubmissions.add(event);
	}
	// Queue events are full snapshots, so only the newest one matters.
	const queueEvents = queueSnapshotApplied
		? events.slice(options.queueSnapshotEventCutoff ?? events.length)
		: events;
	const lastQueueEvent = queueEvents.findLast(
		(event) => event.event === "session.pending_prompts",
	);
	const reconciled: HubEventEnvelope[] = [];
	let segment: HubEventEnvelope[] = [];

	const flush = (terminal: boolean) => {
		if (segment.length === 0) return;
		const snapshotSegment = segment.filter((event) =>
			beforeTranscript.has(event),
		);
		// An interrupted run can contain saved replies followed by unsaved output.
		const contentEnd = (kind: "assistant" | "reasoning") => {
			if (!terminal) return -1;
			const finished =
				segment.at(-1)?.event === "run.completed"
					? -1
					: snapshotSegment.findLastIndex(
							(event) => event.event === `${kind}.finished`,
						);
			return finished >= 0 || segment.at(-1)?.event === "run.aborted"
				? finished
				: snapshotSegment.length - 1;
		};
		const assistantEnd = contentEnd("assistant");
		const reasoningEnd = contentEnd("reasoning");
		const streamed = streamedAssistantText(
			snapshotSegment.slice(0, assistantEnd + 1),
		);
		const persistedIndex = streamed
			? unclaimedAssistantTexts.findIndex((text) => text.endsWith(streamed))
			: -1;
		const contentPersisted = persistedIndex >= 0;
		if (contentPersisted) unclaimedAssistantTexts.splice(persistedIndex, 1);
		const thinking = streamedAssistantText(
			snapshotSegment.slice(0, reasoningEnd + 1),
			"reasoning",
		);
		const thinkingIndex = thinking
			? unclaimedThinking.findIndex((text) => text.endsWith(thinking))
			: -1;
		if (thinkingIndex >= 0) unclaimedThinking.splice(thinkingIndex, 1);
		for (const [index, event] of segment.entries()) {
			// Preserve the turn-start lifecycle; the UI must only skip its user bubble.
			if (reflectedSubmissions.has(event)) {
				reconciled.push({
					...event,
					payload: { ...event.payload, transcriptReflected: true },
				});
				continue;
			}
			if (
				beforeTranscript.has(event) &&
				SUPERSEDABLE_CONTENT_EVENTS.has(event.event) &&
				(event.event.startsWith("reasoning.")
					? thinkingIndex >= 0 && index <= reasoningEnd
					: contentPersisted && index <= assistantEnd)
			) {
				continue;
			}
			if (
				event.event === "session.pending_prompts" &&
				event !== lastQueueEvent
			) {
				continue;
			}
			// Keep terminal events: run.failed may carry the only error detail.
			if (beforeTranscript.has(event) && event.event.startsWith("tool.")) {
				const toolCallId = String(event.payload?.toolCallId ?? "").trim();
				if (
					snapshotToolResultIds.has(toolCallId) ||
					(event.event === "tool.started" &&
						snapshotToolCallIds.has(toolCallId))
				)
					continue;
			}
			reconciled.push(event);
		}
		segment = [];
	};

	for (const event of events) {
		segment.push(event);
		if (TERMINAL_RUN_EVENTS.has(event.event)) flush(true);
	}
	// Never supersede an unterminated tail.
	flush(false);
	return reconciled;
}
