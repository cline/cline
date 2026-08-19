import type { Message } from "@cline/llms"
import { describe, expect, it, vi } from "vitest"

// The shared vscode vitest stub does not define the Language Model API classes,
// so mock the small subset the transform uses. Each class records enough to
// assert structure in tests.
vi.mock("vscode", () => {
	class LanguageModelTextPart {
		constructor(public value: string) {}
	}
	class LanguageModelToolCallPart {
		constructor(
			public callId: string,
			public name: string,
			public input: object,
		) {}
	}
	class LanguageModelToolResultPart {
		constructor(
			public callId: string,
			public content: unknown[],
		) {}
	}
	const LanguageModelChatMessage = {
		User: (content: unknown) => ({ role: "user", content }),
		Assistant: (content: unknown) => ({ role: "assistant", content }),
	}
	return { LanguageModelTextPart, LanguageModelToolCallPart, LanguageModelToolResultPart, LanguageModelChatMessage }
})

// Logger is referenced by asObjectSafe; stub it to avoid host dependencies.
vi.mock("@/shared/services/Logger", () => ({ Logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const { convertToVsCodeLmMessages, asObjectSafe } = await import("./vscode-lm-format")
const vscode = await import("vscode")

describe("convertToVsCodeLmMessages", () => {
	it("converts simple string user/assistant messages", () => {
		const messages: Message[] = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		]
		const result = convertToVsCodeLmMessages(messages)
		expect(result).toEqual([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		])
	})

	it("converts a user message with text + tool_result, tool results first", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "after tool" },
					{ type: "tool_result", tool_use_id: "call-1", name: "read", content: "file contents" },
				],
			},
		]
		const [message] = convertToVsCodeLmMessages(messages)
		const content = message.content as unknown[]
		// Tool result part is emitted before the text part.
		expect(content[0]).toBeInstanceOf(vscode.LanguageModelToolResultPart)
		expect((content[0] as { callId: string }).callId).toBe("call-1")
		expect(content[1]).toBeInstanceOf(vscode.LanguageModelTextPart)
		expect((content[1] as { value: string }).value).toBe("after tool")
	})

	it("renders images as placeholders (VS Code LM does not accept images)", () => {
		const messages: Message[] = [{ role: "user", content: [{ type: "image", data: "abc", mediaType: "image/png" }] }]
		const [message] = convertToVsCodeLmMessages(messages)
		const part = (message.content as { value: string }[])[0]
		expect(part).toBeInstanceOf(vscode.LanguageModelTextPart)
		expect(part.value).toContain("image/png")
		expect(part.value).toContain("not supported")
	})

	it("extracts text from structured (untyped) tool_result content (run_commands shape)", () => {
		// SDK tool executors return rich, untyped objects (ToolOperationResult:
		// { query, result, success }) — NOT typed text blocks. The result text
		// must reach the model, not an empty string.
		const messages: Message[] = [
			{ role: "assistant", content: [{ type: "tool_use", id: "c1", name: "run_commands", input: {} }] },
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "c1",
						name: "run_commands",
						// biome-ignore lint/suspicious/noExplicitAny: simulating runtime untyped content
						content: [{ query: "ls", result: "demo.ts\ndemo.txt\nsrc\n", success: true }] as any,
					},
				],
			},
			{ role: "user", content: "continue" },
		]
		const result = convertToVsCodeLmMessages(messages)
		const toolResultMsg = result[1]
		const trPart = (toolResultMsg.content as { content: { value: string }[] }[])[0]
		expect(trPart).toBeInstanceOf(vscode.LanguageModelToolResultPart)
		// The inner text part must contain the actual command output, not "".
		expect(trPart.content[0].value).toBe("demo.ts\ndemo.txt\nsrc\n")
	})

	it("appends a trailing plain user message when the convo ends on tool results", () => {
		const messages: Message[] = [
			{ role: "assistant", content: [{ type: "tool_use", id: "c1", name: "read", input: {} }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "c1", name: "read", content: "file body" }] },
		]
		const result = convertToVsCodeLmMessages(messages)
		// Last message must NOT be the tool-result one (Copilot requirement); it's
		// a plain string user message (LanguageModelChatMessage.User(string)).
		const last = result[result.length - 1]
		expect(last.role).toBe("user")
		expect(typeof last.content).toBe("string")
		expect(last.content as unknown as string).toContain("result of calling one or more tools")
		// The tool-result message is preserved before the nudge.
		expect(result).toHaveLength(3)
		expect((result[1].content as unknown[])[0]).toBeInstanceOf(vscode.LanguageModelToolResultPart)
	})

	it("does NOT append a trailing nudge when the convo ends on a normal user message", () => {
		const messages: Message[] = [
			{ role: "assistant", content: [{ type: "tool_use", id: "c1", name: "read", input: {} }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "c1", name: "read", content: "body" }] },
			{ role: "user", content: "thanks, continue" },
		]
		const result = convertToVsCodeLmMessages(messages)
		expect(result).toHaveLength(3)
		expect(result[result.length - 1].content).toBe("thanks, continue")
	})

	it("converts an assistant tool_use into a tool call part with object input", () => {
		const messages: Message[] = [
			{ role: "assistant", content: [{ type: "tool_use", id: "call-9", name: "edit", input: { path: "a.ts" } }] },
		]
		const [message] = convertToVsCodeLmMessages(messages)
		const part = (message.content as unknown[])[0]
		expect(part).toBeInstanceOf(vscode.LanguageModelToolCallPart)
		expect((part as { name: string }).name).toBe("edit")
		expect((part as { input: object }).input).toEqual({ path: "a.ts" })
	})
})

describe("asObjectSafe", () => {
	it("parses JSON strings", () => {
		expect(asObjectSafe('{"a":1}')).toEqual({ a: 1 })
	})
	it("clones objects", () => {
		const input = { a: 1 }
		expect(asObjectSafe(input)).toEqual({ a: 1 })
		expect(asObjectSafe(input)).not.toBe(input)
	})
	it("returns {} for nullish or invalid", () => {
		expect(asObjectSafe(null)).toEqual({})
		expect(asObjectSafe("not json")).toEqual({})
	})
})
