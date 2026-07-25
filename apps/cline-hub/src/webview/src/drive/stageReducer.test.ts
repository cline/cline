import { describe, expect, it } from "vitest";
import {
	classifyToolEvent,
	projectStageCardsFromToolEvents,
	projectStageFromMessages,
	upsertStageCard,
	webviewToolEventToStageToolEvent,
	type StageToolEvent,
} from "./stageReducer";

const NOW = "2026-07-25T18:00:00.000Z";

function event(
	partial: Partial<StageToolEvent> & Pick<StageToolEvent, "id" | "name">,
): StageToolEvent {
	return {
		state: "output-available",
		updatedAt: NOW,
		...partial,
	};
}

describe("classifyToolEvent", () => {
	it("maps editor and apply_patch to edit", () => {
		expect(classifyToolEvent({ name: "editor", input: { path: "a.ts" } })).toBe(
			"edit",
		);
		expect(classifyToolEvent({ name: "apply_patch", input: {} })).toBe("edit");
	});

	it("maps run_commands to command, or test when the command looks like tests", () => {
		expect(
			classifyToolEvent({
				name: "run_commands",
				input: { commands: ["bun run build"] },
			}),
		).toBe("command");
		expect(
			classifyToolEvent({
				name: "run_commands",
				input: { commands: ["bun -F @cline/core test:unit"] },
			}),
		).toBe("test");
	});
});

describe("projectStageCardsFromToolEvents", () => {
	it("projects last-event-wins cards for edit, command, and test", () => {
		const cards = projectStageCardsFromToolEvents(
			[
				event({
					id: "e1",
					name: "editor",
					input: { path: "src/router.ts", new_text: "guard()" },
				}),
				event({
					id: "c1",
					name: "run_commands",
					input: { commands: ["bun run build"] },
					output: "built ok",
				}),
				event({
					id: "t1",
					name: "run_commands",
					input: { commands: ["bun test"] },
					output: "3 pass",
				}),
			],
			{ now: NOW },
		);

		expect(cards.map((card) => card.category)).toEqual([
			"edit",
			"command",
			"test",
		]);
		expect(cards[0]?.title).toBe("router.ts");
		expect(cards[1]?.title).toContain("bun run build");
		expect(cards[2]?.title).toContain("bun test");
		expect(cards.every((card) => card.updatedAt === NOW)).toBe(true);
	});

	it("keeps only the latest card per category (last-event-wins)", () => {
		const cards = projectStageCardsFromToolEvents(
			[
				event({
					id: "e1",
					name: "editor",
					input: { path: "a.ts" },
				}),
				event({
					id: "e2",
					toolCallId: "call_e2",
					name: "editor",
					input: { path: "b.ts" },
				}),
			],
			{ now: NOW },
		);

		expect(cards).toHaveLength(1);
		expect(cards[0]?.title).toBe("b.ts");
		expect(cards[0]?.workEventId).toBe("call_e2");
	});

	it("ignores non-stage tools like read_files", () => {
		const cards = projectStageCardsFromToolEvents(
			[
				event({
					id: "r1",
					name: "read_files",
					input: { paths: ["a.ts"] },
				}),
			],
			{ now: NOW },
		);
		expect(cards).toEqual([]);
	});

	it("is deterministic on replay", () => {
		const events = [
			event({
				id: "e1",
				name: "editor",
				input: { path: "x.ts" },
			}),
			event({
				id: "c1",
				name: "run_commands",
				input: { commands: ["echo hi"] },
			}),
		];
		expect(projectStageCardsFromToolEvents(events, { now: NOW })).toEqual(
			projectStageCardsFromToolEvents(events, { now: NOW }),
		);
	});
});

describe("upsertStageCard", () => {
	it("replaces the same category and preserves others", () => {
		const first = {
			id: "card_edit_1",
			category: "edit" as const,
			title: "a.ts",
			updatedAt: NOW,
		};
		const command = {
			id: "card_cmd_1",
			category: "command" as const,
			title: "ls",
			updatedAt: NOW,
		};
		const nextEdit = {
			id: "card_edit_2",
			category: "edit" as const,
			title: "b.ts",
			updatedAt: NOW,
		};
		const cards = upsertStageCard(upsertStageCard([first], command), nextEdit);
		expect(cards.map((c) => c.title)).toEqual(["ls", "b.ts"]);
	});
});

describe("projectStageFromMessages", () => {
	it("flattens toolEvents across messages and sets sharer", () => {
		const stage = projectStageFromMessages(
			[
				{
					toolEvents: [
						event({
							id: "e1",
							name: "editor",
							input: { path: "hub.ts" },
						}),
					],
				},
				{
					toolEvents: [
						event({
							id: "c1",
							name: "run_commands",
							input: { commands: ["pwd"] },
						}),
					],
				},
			],
			{
				now: NOW,
				sharer: { kind: "agent", participantId: "adam" },
			},
		);

		expect(stage.sharer).toEqual({ kind: "agent", participantId: "adam" });
		expect(stage.cards).toHaveLength(2);
		expect(stage.cards.map((card) => card.category)).toEqual([
			"edit",
			"command",
		]);
	});
});

describe("webviewToolEventToStageToolEvent", () => {
	it("maps running/completed/failed statuses onto tool event states", () => {
		expect(
			webviewToolEventToStageToolEvent({
				toolCallId: "t1",
				toolName: "editor",
				status: "running",
				input: { path: "a.ts" },
			}).state,
		).toBe("input-available");
		expect(
			webviewToolEventToStageToolEvent({
				toolCallId: "t1",
				toolName: "editor",
				status: "completed",
			}).state,
		).toBe("output-available");
		expect(
			webviewToolEventToStageToolEvent({
				toolCallId: "t1",
				toolName: "editor",
				status: "failed",
				error: "boom",
			}).state,
		).toBe("output-error");
	});
});
