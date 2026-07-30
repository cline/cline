/**
 * Events-first Stage projection for Hub Chat (Slice A).
 *
 * Maps session toolEvents / WebviewToolEvent-shaped rows onto Drive work events,
 * then folds with the same reduceRoom / projectStage kernel as live rooms.
 */

import {
	classifyStageToolName,
	createEmptyRoomSnapshot,
	projectStage,
	reduceRoom,
} from "@cline/drive";
import {
	DRIVE_SCHEMA_VERSION,
	type DriveEvent,
	type StageCard,
	type StageSharer,
	type StageState,
} from "@cline/shared";

/** Chat message toolEvents row (webview-protocol shape). */
export type StageToolEvent = {
	id: string;
	toolCallId?: string;
	name: string;
	text?: string;
	state: "input-available" | "output-available" | "output-error";
	input?: unknown;
	output?: unknown;
	error?: string;
	/** ISO datetime; defaults when projecting if omitted. */
	updatedAt?: string;
};

export type StageCategory = Extract<
	StageCard["category"],
	"edit" | "command" | "test"
>;

const STAGE_CATEGORIES: readonly StageCategory[] = [
	"edit",
	"command",
	"test",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return null;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function stringifyCompact(value: unknown, max = 400): string | undefined {
	if (value == null) {
		return undefined;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
	}
	try {
		const json = JSON.stringify(value, null, 2);
		if (!json) {
			return undefined;
		}
		return json.length > max ? `${json.slice(0, max)}…` : json;
	} catch {
		return undefined;
	}
}

function firstCommandFromInput(input: unknown): string | undefined {
	const record = asRecord(input);
	if (!record) {
		return asString(input);
	}
	const commands = record.commands;
	if (typeof commands === "string") {
		return asString(commands);
	}
	if (Array.isArray(commands) && commands.length > 0) {
		const first = commands[0];
		if (typeof first === "string") {
			return asString(first);
		}
		const entry = asRecord(first);
		return (
			asString(entry?.command) ??
			asString(entry?.cmd) ??
			asString(entry?.script)
		);
	}
	return (
		asString(record.command) ??
		asString(record.cmd) ??
		asString(record.script)
	);
}

function pathFromInput(input: unknown): string | undefined {
	const record = asRecord(input);
	if (!record) {
		return undefined;
	}
	return (
		asString(record.path) ??
		asString(record.file_path) ??
		asString(record.filePath) ??
		asString(record.filename)
	);
}

function pathFromPatch(input: unknown): string | undefined {
	const text =
		asString(input) ??
		asString(asRecord(input)?.input) ??
		asString(asRecord(input)?.patch);
	if (!text) {
		return undefined;
	}
	const match = text.match(/\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+)/);
	return match?.[1]?.trim();
}

export function classifyToolEvent(
	event: Pick<StageToolEvent, "name" | "input" | "text">,
): StageCategory | null {
	const commandHint = firstCommandFromInput(event.input) ?? event.text;
	return classifyStageToolName(event.name, commandHint);
}

function titleForEvent(
	category: StageCategory,
	event: StageToolEvent,
): string {
	switch (category) {
		case "edit": {
			const path =
				pathFromInput(event.input) ??
				pathFromPatch(event.input) ??
				event.name;
			const base = path.split(/[/\\]/).pop() ?? path;
			return base;
		}
		case "command": {
			const command = firstCommandFromInput(event.input);
			if (command) {
				const firstLine = command.split("\n")[0] ?? command;
				return firstLine.length > 64
					? `${firstLine.slice(0, 61)}…`
					: firstLine;
			}
			return event.name;
		}
		case "test": {
			const command = firstCommandFromInput(event.input);
			if (command) {
				const firstLine = command.split("\n")[0] ?? command;
				return firstLine.length > 64
					? `${firstLine.slice(0, 61)}…`
					: firstLine;
			}
			return event.name;
		}
		default: {
			const _exhaustive: never = category;
			return _exhaustive;
		}
	}
}

function summaryForEvent(
	category: StageCategory,
	event: StageToolEvent,
): string | undefined {
	if (event.error) {
		return event.error;
	}
	switch (category) {
		case "edit": {
			const path =
				pathFromInput(event.input) ?? pathFromPatch(event.input);
			const detail =
				stringifyCompact(asRecord(event.input)?.new_text, 240) ??
				stringifyCompact(event.output, 240) ??
				asString(event.text);
			if (path && detail) {
				return `${path}\n${detail}`;
			}
			return detail ?? path ?? asString(event.text);
		}
		case "command": {
			return (
				stringifyCompact(event.output, 600) ??
				firstCommandFromInput(event.input) ??
				asString(event.text)
			);
		}
		case "test": {
			if (event.state === "output-error") {
				return (
					stringifyCompact(event.output, 400) ??
					asString(event.text) ??
					"failed"
				);
			}
			if (event.state === "output-available") {
				return (
					stringifyCompact(event.output, 400) ??
					asString(event.text) ??
					"passed"
				);
			}
			return (
				firstCommandFromInput(event.input) ??
				asString(event.text) ??
				"running"
			);
		}
		default: {
			const _exhaustive: never = category;
			return _exhaustive;
		}
	}
}

function cardIdFor(event: StageToolEvent, category: StageCategory): string {
	return event.toolCallId
		? `stage_${category}_${event.toolCallId}`
		: `stage_${category}_${event.id}`;
}

export function toolEventToStageCard(
	event: StageToolEvent,
	now: string,
): StageCard | null {
	const category = classifyToolEvent(event);
	if (!category) {
		return null;
	}
	return {
		id: cardIdFor(event, category),
		category,
		title: titleForEvent(category, event),
		summary: summaryForEvent(category, event),
		workEventId: event.toolCallId ?? event.id,
		updatedAt: event.updatedAt ?? now,
	};
}

/** Last-event-wins upsert: one card per stage category. */
export function upsertStageCard(
	cards: readonly StageCard[],
	card: StageCard,
): StageCard[] {
	const without = cards.filter((c) => c.category !== card.category);
	return [...without, card];
}

const TOOL_STAGE_ROOM_ID = "webview-tool-stage";

/**
 * Map a chat tool event onto a Drive work.* event for reduceRoom.
 * Returns null for tools that do not create stage cards.
 */
export function toolEventToDriveEvent(
	event: StageToolEvent,
	options: { roomId: string; now: string },
): DriveEvent | null {
	const category = classifyToolEvent(event);
	if (!category) {
		return null;
	}
	const at = event.updatedAt ?? options.now;
	const id = event.toolCallId ?? event.id;
	const summary = summaryForEvent(category, event);
	switch (category) {
		case "edit": {
			const path =
				pathFromInput(event.input) ??
				pathFromPatch(event.input) ??
				event.name;
			const baseName = path.split(/[/\\]/).pop() ?? path;
			return {
				schemaVersion: DRIVE_SCHEMA_VERSION,
				type: "work.edit",
				track: "work",
				id,
				roomId: options.roomId,
				at,
				path: baseName,
				summary,
			};
		}
		case "command": {
			const command =
				firstCommandFromInput(event.input) ??
				asString(event.text) ??
				event.name;
			const firstLine = command.split("\n")[0] ?? command;
			const title =
				firstLine.length > 64 ? `${firstLine.slice(0, 61)}…` : firstLine;
			return {
				schemaVersion: DRIVE_SCHEMA_VERSION,
				type: "work.command",
				track: "work",
				id,
				roomId: options.roomId,
				at,
				command: title,
				failed: event.state === "output-error",
				summary,
			};
		}
		case "test": {
			return {
				schemaVersion: DRIVE_SCHEMA_VERSION,
				type: "work.test_result",
				track: "work",
				id,
				roomId: options.roomId,
				at,
				label: titleForEvent("test", event),
				passed: event.state !== "output-error",
				summary,
			};
		}
		default: {
			const _exhaustive: never = category;
			return _exhaustive;
		}
	}
}

/**
 * Project an ordered tool-event stream into Stage cards via reduceRoom.
 * Only edit / command / test categories are kept (MVP stage surface).
 */
export function projectStageCardsFromToolEvents(
	events: readonly StageToolEvent[],
	options?: { now?: string; roomId?: string },
): StageCard[] {
	const now = options?.now ?? new Date().toISOString();
	const roomId = options?.roomId ?? TOOL_STAGE_ROOM_ID;
	let snapshot = createEmptyRoomSnapshot({ roomId, createdAt: now });
	for (const event of events) {
		const driveEvent = toolEventToDriveEvent(event, { roomId, now });
		if (!driveEvent) {
			continue;
		}
		snapshot = reduceRoom(snapshot, driveEvent);
	}
	const cards = projectStage(snapshot).cards;
	return STAGE_CATEGORIES.map((category) =>
		cards.find((card) => card.category === category),
	).filter((card): card is StageCard => card != null);
}

export function collectToolEventsFromMessages(
	messages: ReadonlyArray<{ toolEvents?: readonly StageToolEvent[] }>,
): StageToolEvent[] {
	const collected: StageToolEvent[] = [];
	for (const message of messages) {
		for (const event of message.toolEvents ?? []) {
			collected.push(event);
		}
	}
	return collected;
}

export function projectStageFromMessages(
	messages: ReadonlyArray<{ toolEvents?: readonly StageToolEvent[] }>,
	options?: {
		now?: string;
		sharer?: StageSharer | null;
	},
): StageState {
	const events = collectToolEventsFromMessages(messages);
	return {
		sharer: options?.sharer ?? null,
		pin: null,
		cards: projectStageCardsFromToolEvents(events, { now: options?.now }),
	};
}

/** Map a live WebviewToolEvent into a StageToolEvent row for incremental reduce. */
export function webviewToolEventToStageToolEvent(input: {
	toolCallId?: string;
	toolName?: string;
	status: "running" | "completed" | "failed";
	input?: unknown;
	output?: unknown;
	error?: string;
	text?: string;
	id?: string;
	updatedAt?: string;
}): StageToolEvent {
	const state =
		input.status === "failed"
			? "output-error"
			: input.status === "completed"
				? "output-available"
				: "input-available";
	return {
		id: input.id ?? input.toolCallId ?? `tool_${input.toolName ?? "unknown"}`,
		toolCallId: input.toolCallId,
		name: input.toolName ?? "tool",
		text: input.text,
		state,
		input: input.input,
		output: input.output,
		error: input.error,
		updatedAt: input.updatedAt,
	};
}
