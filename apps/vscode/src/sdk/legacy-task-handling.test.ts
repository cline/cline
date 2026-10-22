import type { HistoryItem } from "@shared/HistoryItem"
import { describe, expect, it } from "vitest"
import { legacyApiHistoryToSdkMessages } from "./legacy-task-handling"

const baseHistoryItem = { id: "task-1" } as HistoryItem

function textMessage(role: "user" | "assistant", text: string) {
	return { role, content: [{ type: "text", text }] }
}

describe("legacyApiHistoryToSdkMessages", () => {
	it("converts the full history when no deleted range is recorded", () => {
		const messages = legacyApiHistoryToSdkMessages(
			[
				textMessage("user", "first task"),
				textMessage("assistant", "first answer"),
				textMessage("user", "middle request"),
				textMessage("assistant", "middle answer"),
			],
			baseHistoryItem,
		)

		const serialized = JSON.stringify(messages)
		expect(serialized).toContain("first task")
		expect(serialized).toContain("middle request")
		expect(serialized).toContain("middle answer")
	})

	it("replays the classic truncation range instead of resurrecting the full history", () => {
		// Classic Cline sent [first user-assistant pair, ...messages after the
		// range end] to the API while keeping the full history on disk.
		// Migration must produce the same working context, or a long task
		// resumes with millions of tokens the classic extension had already
		// truncated away (cline/cline#12996).
		const apiHistory = [
			textMessage("user", "first task"),
			textMessage("assistant", "first answer"),
			textMessage("user", "truncated request 1"),
			textMessage("assistant", "truncated answer 1"),
			textMessage("user", "truncated request 2"),
			textMessage("assistant", "truncated answer 2"),
			textMessage("user", "kept request"),
			textMessage("assistant", "kept answer"),
		]

		const messages = legacyApiHistoryToSdkMessages(apiHistory, {
			...baseHistoryItem,
			conversationHistoryDeletedRange: [2, 5],
		})

		const serialized = JSON.stringify(messages)
		expect(serialized).toContain("first task")
		expect(serialized).toContain("first answer")
		expect(serialized).toContain("kept request")
		expect(serialized).toContain("kept answer")
		expect(serialized).not.toContain("truncated request 1")
		expect(serialized).not.toContain("truncated answer 2")
	})

	it("strips orphaned tool_results from the first message after the cut", () => {
		// The message right after the cut can carry tool_results whose
		// tool_use was truncated away; classic filtered them out and so must
		// the migration, or providers reject the resumed conversation.
		const apiHistory = [
			textMessage("user", "first task"),
			textMessage("assistant", "first answer"),
			textMessage("user", "truncated request"),
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tool-gone", name: "read_file", input: {} }],
			},
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "tool-gone", content: "orphaned result" },
					{ type: "text", text: "environment details" },
				],
			},
			textMessage("assistant", "kept answer"),
		]

		const messages = legacyApiHistoryToSdkMessages(apiHistory, {
			...baseHistoryItem,
			conversationHistoryDeletedRange: [2, 3],
		})

		const serialized = JSON.stringify(messages)
		expect(serialized).not.toContain("orphaned result")
		expect(serialized).not.toContain("tool-gone")
		expect(serialized).toContain("environment details")
		expect(serialized).toContain("kept answer")
	})

	it("ignores a malformed deleted range", () => {
		const apiHistory = [
			textMessage("user", "first task"),
			textMessage("assistant", "first answer"),
			textMessage("user", "latest request"),
		]

		for (const range of [
			[2, 99],
			[2, 2],
			[0, 1],
			[2, 1.5],
		] as Array<[number, number]>) {
			const messages = legacyApiHistoryToSdkMessages(apiHistory, {
				...baseHistoryItem,
				conversationHistoryDeletedRange: range,
			})
			expect(JSON.stringify(messages)).toContain("latest request")
			expect(JSON.stringify(messages)).toContain("first answer")
		}
	})
})
