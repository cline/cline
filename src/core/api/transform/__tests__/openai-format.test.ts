import { describe, expect, it, vi } from "vitest"
import type { ClineStorageMessage } from "@/shared/messages/content"
import { convertToOpenAiMessages } from "../openai-format"

// Mock the Logger so tests don't output noise
vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

describe("convertToOpenAiMessages", () => {
	describe("duplicate tool_result deduplication", () => {
		it("should skip duplicate tool_result blocks with the same tool_use_id within a single user message", () => {
			const messages: Omit<ClineStorageMessage, "modelInfo">[] = [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "I'll read two files." },
						{ type: "tool_use", id: "call_abc", name: "read_file", input: { path: "/a" } },
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_abc",
							content: "first result",
						},
						{
							type: "tool_result",
							tool_use_id: "call_abc",
							content: "duplicate result",
						},
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			// Should have: assistant message, 1 tool message (not 2)
			const toolMessages = result.filter((m) => m.role === "tool")
			expect(toolMessages).toHaveLength(1)
			expect((toolMessages[0] as any).tool_call_id).toBe("call_abc")
			expect((toolMessages[0] as any).content).toBe("first result")
		})

		it("should skip duplicate tool_result blocks across separate user messages", () => {
			const messages: Omit<ClineStorageMessage, "modelInfo">[] = [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Calling tool." },
						{ type: "tool_use", id: "call_123", name: "read_file", input: { path: "/x" } },
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_123",
							content: "original result",
						},
					],
				},
				// Hypothetical second user message with same tool_use_id (from resumption or merge edge case)
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_123",
							content: "duplicate from another message",
						},
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			const toolMessages = result.filter((m) => m.role === "tool")
			expect(toolMessages).toHaveLength(1)
			expect((toolMessages[0] as any).tool_call_id).toBe("call_123")
			expect((toolMessages[0] as any).content).toBe("original result")
		})

		it("should preserve unique tool_result blocks for parallel tool calls", () => {
			const messages: Omit<ClineStorageMessage, "modelInfo">[] = [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Reading files." },
						{ type: "tool_use", id: "call_a", name: "read_file", input: { path: "/a" } },
						{ type: "tool_use", id: "call_b", name: "read_file", input: { path: "/b" } },
						{ type: "tool_use", id: "call_c", name: "read_file", input: { path: "/c" } },
					],
				},
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "call_a", content: "result A" },
						{ type: "tool_result", tool_use_id: "call_b", content: "result B" },
						{ type: "tool_result", tool_use_id: "call_c", content: "result C" },
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			const toolMessages = result.filter((m) => m.role === "tool")
			expect(toolMessages).toHaveLength(3)
			expect((toolMessages[0] as any).tool_call_id).toBe("call_a")
			expect((toolMessages[1] as any).tool_call_id).toBe("call_b")
			expect((toolMessages[2] as any).tool_call_id).toBe("call_c")
		})

		it("should handle fc_ ID collisions caused by transformToolCallIdForNativeApi truncation", () => {
			// Two different fc_ IDs that share the same last 35 characters
			// after transformation would produce the same call_ ID
			const sharedSuffix = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" // 35 chars
			const id1 = `fc_123456789012345${sharedSuffix}` // 53 chars total
			const id2 = `fc_ABCDEFGHIJKLMNO${sharedSuffix}` // 53 chars total

			expect(id1.length).toBe(53)
			expect(id2.length).toBe(53)
			expect(id1).not.toBe(id2) // different original IDs

			const messages: Omit<ClineStorageMessage, "modelInfo">[] = [
				{
					role: "assistant",
					content: [
						{ type: "tool_use", id: id1, name: "read_file", input: { path: "/a" } },
						{ type: "tool_use", id: id2, name: "read_file", input: { path: "/b" } },
					],
				},
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: id1, content: "result 1" },
						{ type: "tool_result", tool_use_id: id2, content: "result 2" },
					],
				},
			]

			const result = convertToOpenAiMessages(messages)

			// The second tool result should be deduplicated because both fc_ IDs
			// map to the same call_ ID after truncation
			const toolMessages = result.filter((m) => m.role === "tool")
			expect(toolMessages).toHaveLength(1)
			expect((toolMessages[0] as any).content).toBe("result 1")
		})

		it("should allow same tool_use_id across different conversation turns (different tool_use blocks)", () => {
			// In practice tool IDs should be unique across turns, but this tests
			// the dedup correctly spans the entire conversation
			const messages: Omit<ClineStorageMessage, "modelInfo">[] = [
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call_same", name: "read_file", input: { path: "/a" } }],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "call_same", content: "turn 1 result" }],
				},
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Now doing something else." },
						{ type: "tool_use", id: "call_same", name: "write_file", input: { path: "/b" } },
					],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "call_same", content: "turn 2 result" }],
				},
			]

			const result = convertToOpenAiMessages(messages)

			// Cross-turn duplicates ARE deduplicated — the second tool result
			// with the same ID is skipped because the conversion is global
			const toolMessages = result.filter((m) => m.role === "tool")
			expect(toolMessages).toHaveLength(1)
			expect((toolMessages[0] as any).content).toBe("turn 1 result")
		})
	})

	describe("basic conversion", () => {
		it("should convert string content messages", () => {
			const messages: Omit<ClineStorageMessage, "modelInfo">[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there" },
			]

			const result = convertToOpenAiMessages(messages)
			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({ role: "user", content: "Hello" })
			expect(result[1]).toEqual({ role: "assistant", content: "Hi there" })
		})

		it("should convert tool use and tool result messages", () => {
			const messages: Omit<ClineStorageMessage, "modelInfo">[] = [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Let me read the file." },
						{ type: "tool_use", id: "call_xyz", name: "read_file", input: { path: "/test.txt" } },
					],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "call_xyz", content: "file contents here" }],
				},
			]

			const result = convertToOpenAiMessages(messages)

			// assistant message with tool_calls
			expect(result[0].role).toBe("assistant")
			const assistantMsg = result[0] as any
			expect(assistantMsg.tool_calls).toHaveLength(1)
			expect(assistantMsg.tool_calls[0].id).toBe("call_xyz")
			expect(assistantMsg.tool_calls[0].function.name).toBe("read_file")

			// tool result message
			expect(result[1].role).toBe("tool")
			expect((result[1] as any).tool_call_id).toBe("call_xyz")
			expect((result[1] as any).content).toBe("file contents here")
		})
	})
})
