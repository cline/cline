import type { ProviderConfig, ToolDefinition } from "@cline/llms"
import { describe, expect, it, vi } from "vitest"

// Real-enough `vscode` mock: the handler uses `instanceof` on the stream parts
// and the LanguageModelChatToolMode enum, and constructs a CancellationTokenSource.
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
	class CancellationTokenSource {
		token = {}
		cancel = vi.fn()
		dispose = vi.fn()
	}
	class CancellationError extends Error {}
	return {
		LanguageModelTextPart,
		LanguageModelToolCallPart,
		LanguageModelToolResultPart,
		CancellationTokenSource,
		CancellationError,
		LanguageModelChatToolMode: { Auto: 1, Required: 2 },
		lm: { selectChatModels: vi.fn() },
		LanguageModelChatMessage: {
			User: (content: unknown) => ({ role: "user", content }),
			Assistant: (content: unknown) => ({ role: "assistant", content }),
		},
	}
})
vi.mock("@/shared/services/Logger", () => ({ Logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const { parseVsCodeLmSelector, VsCodeLmHandler } = await import("./vscode-lm-handler")
const vscode = await import("vscode")

describe("parseVsCodeLmSelector", () => {
	it("returns an empty selector for empty/undefined input", () => {
		expect(parseVsCodeLmSelector(undefined)).toEqual({})
		expect(parseVsCodeLmSelector("")).toEqual({})
	})

	it("parses vendor/family (the common case)", () => {
		expect(parseVsCodeLmSelector("copilot/claude-sonnet")).toEqual({
			vendor: "copilot",
			family: "claude-sonnet",
		})
	})

	it("parses vendor/family/version/id positionally", () => {
		expect(parseVsCodeLmSelector("copilot/claude-sonnet/1.0/abc")).toEqual({
			vendor: "copilot",
			family: "claude-sonnet",
			version: "1.0",
			id: "abc",
		})
	})

	it("omits trailing missing segments", () => {
		expect(parseVsCodeLmSelector("copilot")).toEqual({ vendor: "copilot" })
	})
})

// Build a fake LanguageModelChat whose stream yields the given parts, and
// capture the requestOptions passed to sendRequest for assertions.
function fakeModel(parts: unknown[]) {
	const calls: { options: any }[] = []
	const model = {
		id: "copilot-claude",
		name: "Claude",
		vendor: "copilot",
		family: "claude-sonnet",
		version: "1",
		maxInputTokens: 200_000,
		sendRequest: vi.fn((_messages: unknown, options: any) => {
			calls.push({ options })
			return Promise.resolve({
				stream: (async function* () {
					for (const part of parts) {
						yield part
					}
				})(),
				text: (async function* () {})(),
			})
		}),
		countTokens: vi.fn(async () => 0),
	}
	return { model, calls }
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
	const out: T[] = []
	for await (const v of gen) {
		out.push(v)
	}
	return out
}

const config = { providerId: "vscode-lm", modelId: "copilot/claude-sonnet" } as ProviderConfig

describe("VsCodeLmHandler.createMessage tool calling", () => {
	it("passes tools + Auto toolMode to sendRequest when tools are provided", async () => {
		const { model, calls } = fakeModel([new vscode.LanguageModelTextPart("hello")])
		vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([model] as never)

		const handler = new VsCodeLmHandler(config)
		const tools: ToolDefinition[] = [
			{
				name: "read_file",
				description: "Reads a file",
				inputSchema: { type: "object", properties: { path: { type: "string" } } },
			},
		]
		await collect(handler.createMessage("sys", [{ role: "user", content: "hi" }], tools))

		expect(calls).toHaveLength(1)
		expect(calls[0].options.toolMode).toBe(vscode.LanguageModelChatToolMode.Auto)
		expect(calls[0].options.tools).toEqual([
			{
				name: "read_file",
				description: "Reads a file",
				inputSchema: { type: "object", properties: { path: { type: "string" } } },
			},
		])
	})

	it("does not set tools when none are provided", async () => {
		const { model, calls } = fakeModel([new vscode.LanguageModelTextPart("hi")])
		vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([model] as never)

		const handler = new VsCodeLmHandler(config)
		await collect(handler.createMessage("sys", [{ role: "user", content: "hi" }]))

		expect(calls[0].options.tools).toBeUndefined()
		expect(calls[0].options.toolMode).toBeUndefined()
	})

	it("emits a native tool_calls chunk for a LanguageModelToolCallPart", async () => {
		const { model } = fakeModel([
			new vscode.LanguageModelTextPart("thinking"),
			new vscode.LanguageModelToolCallPart("call-1", "read_file", { path: "a.ts" }),
		])
		vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([model] as never)

		const handler = new VsCodeLmHandler(config)
		const chunks = await collect(
			handler.createMessage(
				"sys",
				[{ role: "user", content: "hi" }],
				[{ name: "read_file", description: "", inputSchema: {} }],
			),
		)

		const toolChunk = chunks.find((c) => c.type === "tool_calls")
		expect(toolChunk).toEqual({
			type: "tool_calls",
			id: expect.any(String),
			tool_call: {
				call_id: "call-1",
				function: { id: "call-1", name: "read_file", arguments: { path: "a.ts" } },
			},
		})
		// A text chunk and a final usage chunk are also present.
		expect(chunks.some((c) => c.type === "text" && c.text === "thinking")).toBe(true)
		expect(chunks.at(-1)?.type).toBe("usage")
	})
})
