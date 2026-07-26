/**
 * Events-first Stage projection for Hub Chat (Slice A).
 *
 * Maps session toolEvents / WebviewToolEvent-shaped rows onto @cline/shared
 * StageCard semantics (last-event-wins per edit|command|test), without hub
 * call_* room ops.
 */

import type { StageCard, StageSharer, StageState } from "@cline/shared";

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

const EDIT_TOOLS = new Set([
	"editor",
	"apply_patch",
	"write_to_file",
	"replace_in_file",
	"edit",
	"str_replace",
	"create_file",
]);

const COMMAND_TOOLS = new Set([
	"run_commands",
	"bash",
	"execute_command",
	"shell",
	"run_terminal_cmd",
]);

const TEST_NAME_RE =
	/\b(test|tests|vitest|jest|pytest|mocha|playwright|cypress|bun\s+test)\b/i;

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

function looksLikeTestCommand(command: string | undefined): boolean {
	if (!command) {
		return false;
	}
	return TEST_NAME_RE.test(command);
}

export function classifyToolEvent(
	event: Pick<StageToolEvent, "name" | "input" | "text">,
): StageCategory | null {
	const name = event.name.trim().toLowerCase();
	if (EDIT_TOOLS.has(name)) {
		return "edit";
	}
	if (COMMAND_TOOLS.has(name) || name.includes("command") || name === "bash") {
		const command = firstCommandFromInput(event.input) ?? event.text;
		return looksLikeTestCommand(command) ? "test" : "command";
	}
	if (name.includes("test")) {
		return "test";
	}
	return null;
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

/**
 * Project an ordered tool-event stream into Stage cards.
 * Only edit / command / test categories are kept (MVP stage surface).
 */
export function projectStageCardsFromToolEvents(
	events: readonly StageToolEvent[],
	options?: { now?: string },
): StageCard[] {
	const now = options?.now ?? new Date().toISOString();
	let cards: StageCard[] = [];
	for (const event of events) {
		const card = toolEventToStageCard(event, now);
		if (!card) {
			continue;
		}
		if (
			card.category === "edit" ||
			card.category === "command" ||
			card.category === "test"
		) {
			cards = upsertStageCard(cards, card);
		}
	}
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
