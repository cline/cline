import { describe, expect, it } from "vitest";
import type { PendingPromptSnapshot } from "../../runtime/session-events";
import {
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
