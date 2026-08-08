import { describe, expect, it } from "vitest";
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
});
