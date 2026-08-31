import type { CheckpointEntry } from "@cline/core";
import type { Message } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { buildCheckpointPickerItems } from "./checkpoint-picker-items";

function userPrompt(text: string): Message {
	return { role: "user", content: [{ type: "text", text }] } as Message;
}

function toolResult(): Message {
	return {
		role: "user",
		content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }],
	} as unknown as Message;
}

function assistant(text: string): Message {
	return { role: "assistant", content: [{ type: "text", text }] } as Message;
}

const history: CheckpointEntry[] = [
	{ ref: "ref1", createdAt: 1, runCount: 1, kind: "commit" },
	{ ref: "ref2", createdAt: 2, runCount: 2, kind: "stash" },
];

describe("buildCheckpointPickerItems", () => {
	it("numbers runs span-aware so tool-result messages don't inflate the count", () => {
		// A transcript with tool-result messages (role "user") between prompts,
		// exactly the shape that made the old raw-role counting emit run 5 for
		// the second prompt and abort restore.
		const messages: Message[] = [
			userPrompt("first request"),
			assistant("working"),
			toolResult(),
			assistant("working more"),
			toolResult(),
			userPrompt("second request"),
			assistant("done"),
			toolResult(),
		];

		const items = buildCheckpointPickerItems(messages, history);

		expect(items.map((item) => item.runCount)).toEqual([1, 2]);
		expect(items.map((item) => item.text)).toEqual([
			"first request",
			"second request",
		]);
	});

	it("maps each real user turn to the nearest checkpoint at or before it", () => {
		const messages: Message[] = [
			userPrompt("first request"),
			toolResult(),
			userPrompt("second request"),
		];

		const items = buildCheckpointPickerItems(messages, [
			{ ref: "only", createdAt: 1, runCount: 1, kind: "commit" },
		]);

		// Run 2 has no exact checkpoint; it falls back to the run-1 entry.
		expect(items).toEqual([
			expect.objectContaining({ runCount: 1, text: "first request" }),
			expect.objectContaining({ runCount: 2, text: "second request" }),
		]);
	});

	it("counts a compaction summary as spanning the runs it folded", () => {
		const compaction = {
			role: "user",
			content: [{ type: "text", text: "Compacted context" }],
			metadata: { kind: "compaction", userRunSpan: 2 },
		} as unknown as Message;
		const messages: Message[] = [compaction, userPrompt("third request")];

		const items = buildCheckpointPickerItems(messages, [
			{ ref: "r3", createdAt: 3, runCount: 3, kind: "stash" },
		]);

		expect(items).toEqual([
			expect.objectContaining({ runCount: 3, text: "third request" }),
		]);
	});
});
