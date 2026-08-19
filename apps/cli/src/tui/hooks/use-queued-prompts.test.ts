import { describe, expect, it } from "vitest";
import type { PendingPromptSnapshot } from "../../runtime/session-events";
import {
	monitorPromptLabel,
	resolveQueuedPromptSelection,
	toQueuedPromptItems,
} from "./use-queued-prompts";

describe("queued prompt helpers", () => {
	it("maps pending prompt snapshots to TUI queue items", () => {
		const event: PendingPromptSnapshot = {
			sessionId: "sess-1",
			prompts: [
				{
					id: "pending-1",
					prompt: "keep going",
					delivery: "queue",
					attachmentCount: 2,
				},
				{
					id: "pending-2",
					prompt: "change direction",
					delivery: "steer",
					attachmentCount: 0,
				},
			],
		};

		expect(toQueuedPromptItems(event)).toEqual([
			{
				id: "pending-1",
				prompt: "keep going",
				steer: false,
				attachmentCount: 2,
			},
			{
				id: "pending-2",
				prompt: "change direction",
				steer: true,
				attachmentCount: 0,
			},
		]);
	});

	it("moves up from the input into the closest queued prompt", () => {
		const items = [
			{ id: "first", prompt: "first", steer: false, attachmentCount: 0 },
			{ id: "second", prompt: "second", steer: false, attachmentCount: 0 },
		];

		expect(
			resolveQueuedPromptSelection({
				items,
				selectedId: null,
				direction: "up",
			}),
		).toBe("second");
	});

	it("moves down through the queue and then back to the input", () => {
		const items = [
			{ id: "first", prompt: "first", steer: false, attachmentCount: 0 },
			{ id: "second", prompt: "second", steer: false, attachmentCount: 0 },
		];

		expect(
			resolveQueuedPromptSelection({
				items,
				selectedId: "first",
				direction: "down",
			}),
		).toBe("second");
		expect(
			resolveQueuedPromptSelection({
				items,
				selectedId: "second",
				direction: "down",
			}),
		).toBeNull();
	});
});

describe("monitorPromptLabel", () => {
	it("summarizes monitor origins with names and line counts", () => {
		expect(
			monitorPromptLabel({
				kind: "monitor",
				updates: [
					{
						monitorId: "mon_1",
						name: "ci",
						description: "CI status",
						lines: ["one", "two"],
					},
					{
						monitorId: "mon_1",
						name: "ci",
						description: "CI status",
						lines: ["three"],
					},
				],
			}),
		).toBe("Monitor update from ci (3 lines)");
	});

	it("labels queue items from monitor origins", () => {
		const items = toQueuedPromptItems({
			sessionId: "sess-1",
			prompts: [
				{
					id: "pending-1",
					prompt: "<monitor-output>fenced</monitor-output>",
					delivery: "steer",
					attachmentCount: 0,
					origin: {
						kind: "monitor",
						updates: [
							{
								monitorId: "mon_1",
								name: "applog",
								description: "watching",
								lines: ["hello"],
							},
						],
					},
				},
			],
		});
		expect(items[0]?.displayLabel).toBe("Monitor update from applog (1 line)");
	});
});
