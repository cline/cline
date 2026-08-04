import type { ToolResultContent, ToolUseContent } from "@cline/shared"
import type { HistoryItem } from "@shared/HistoryItem"
import { describe, expect, it } from "vitest"
import { legacyApiHistoryToSdkMessages } from "./legacy-task-handling"

/**
 * Legacy (Anthropic-format) `tool_result` blocks carry no `name` field. The
 * conversion must backfill each result's tool name from the paired
 * `tool_use` block, otherwise a resumed legacy task sends
 * `functionResponse.name: ""` to Gemini, which rejects the request with
 * "Name cannot be empty." (production task-killer for the SDK extension).
 */

const HISTORY_ITEM = {
	id: "task-1",
	ts: 1,
	task: "read a file",
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
} as HistoryItem

function findBlocks<T extends { type: string }>(
	messages: ReturnType<typeof legacyApiHistoryToSdkMessages>,
	type: T["type"],
): T[] {
	const blocks: T[] = []
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue
		}
		for (const block of message.content) {
			if (block.type === type) {
				blocks.push(block as unknown as T)
			}
		}
	}
	return blocks
}

describe("legacyApiHistoryToSdkMessages tool_result names", () => {
	it("backfills tool_result names from the paired tool_use block", () => {
		const messages = legacyApiHistoryToSdkMessages(
			[
				{ role: "user", content: [{ type: "text", text: "read the readme" }] },
				{
					role: "assistant",
					content: [
						{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "README.md" } },
						{ type: "tool_use", id: "toolu_2", name: "list_files", input: { path: "." } },
					],
				},
				{
					role: "user",
					content: [
						// Anthropic-format tool_result blocks: no `name` field.
						{ type: "tool_result", tool_use_id: "toolu_1", content: "# README" },
						{ type: "tool_result", tool_use_id: "toolu_2", content: "README.md\nsrc/" },
					],
				},
			],
			HISTORY_ITEM,
		)

		const results = findBlocks<ToolResultContent>(messages, "tool_result")
		expect(results.map((block) => block.name)).toEqual(["read_file", "list_files"])
	})

	it("keeps an explicit tool_result name when present", () => {
		const messages = legacyApiHistoryToSdkMessages(
			[
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "toolu_1", name: "read_file", input: {} }],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "toolu_1", name: "stored_name", content: "ok" }],
				},
			],
			HISTORY_ITEM,
		)

		const results = findBlocks<ToolResultContent>(messages, "tool_result")
		expect(results.map((block) => block.name)).toEqual(["stored_name"])
	})

	it("leaves the name empty when no paired tool_use exists", () => {
		const messages = legacyApiHistoryToSdkMessages(
			[
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "toolu_missing", content: "orphaned" }],
				},
			],
			HISTORY_ITEM,
		)

		const results = findBlocks<ToolResultContent>(messages, "tool_result")
		expect(results.map((block) => block.name)).toEqual([""])
	})

	it("still converts tool_use blocks unchanged", () => {
		const messages = legacyApiHistoryToSdkMessages(
			[
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.txt" } }],
				},
			],
			HISTORY_ITEM,
		)

		const uses = findBlocks<ToolUseContent>(messages, "tool_use")
		expect(uses).toMatchObject([{ id: "toolu_1", name: "read_file", input: { path: "a.txt" } }])
	})
})
