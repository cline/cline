import { describe, expect, it, vi } from "vitest";
import {
	readPersistedPendingPrompts,
	withPersistedPendingPrompts,
} from "./pending-prompt-persistence";

describe("pending prompt persistence", () => {
	it("round-trips queued prompts without replacing other metadata", () => {
		const prompts = [
			{
				id: "pending_1",
				prompt: "continue with tests",
				mode: "plan" as const,
				delivery: "queue" as const,
				userFiles: ["/workspace/test.ts"],
			},
		];

		const metadata = withPersistedPendingPrompts({ title: "Task" }, prompts);

		expect(metadata.title).toBe("Task");
		expect(readPersistedPendingPrompts(metadata)).toEqual(prompts);
	});

	it("removes the persisted queue when it is cleared", () => {
		const metadata = withPersistedPendingPrompts(
			withPersistedPendingPrompts({}, [
				{ id: "pending_1", prompt: "queued", delivery: "queue" },
			]),
			[],
		);

		expect(metadata).toEqual({});
		expect(readPersistedPendingPrompts(metadata)).toEqual([]);
	});

	it("ignores malformed persisted entries", () => {
		expect(
			readPersistedPendingPrompts({
				"cline.pendingPrompts": [
					null,
					{ id: "missing-prompt", delivery: "queue" },
					{ id: "pending_1", prompt: "valid", delivery: "steer" },
				],
			}),
		).toEqual([{ id: "pending_1", prompt: "valid", delivery: "steer" }]);
	});

	it("warns when malformed entries are discarded on resume", () => {
		const log = vi.fn();
		const prompts = readPersistedPendingPrompts(
			{
				"cline.pendingPrompts": [
					null,
					{ id: "missing-prompt", delivery: "queue" },
					{ id: "pending_1", prompt: "valid", delivery: "steer" },
				],
			},
			{ debug: vi.fn(), log },
		);

		expect(prompts).toEqual([
			{ id: "pending_1", prompt: "valid", delivery: "steer" },
		]);
		expect(log).toHaveBeenCalledWith(
			"Discarded 2 malformed persisted pending prompt(s) on session resume",
			{ severity: "warn" },
		);
	});

	it("does not warn when there is nothing to discard", () => {
		const log = vi.fn();
		readPersistedPendingPrompts({ title: "Task" }, { debug: vi.fn(), log });

		expect(log).not.toHaveBeenCalled();
	});
});
