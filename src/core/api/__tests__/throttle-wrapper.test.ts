import { describe, it } from "mocha"
import "should"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ClineTool } from "@/shared/tools"
import { ApiHandler } from "../index"
import { SanitizedApiHandler } from "../throttle-wrapper"
import { ApiStream, ApiStreamChunk } from "../transform/stream"

/**
 * Helper to convert an async generator to an array for testing
 */
async function streamToArray(stream: ApiStream): Promise<ApiStreamChunk[]> {
	const result: ApiStreamChunk[] = []
	for await (const chunk of stream) {
		result.push(chunk)
	}
	return result
}

/**
 * Mock API handler for testing
 */
class MockApiHandler implements ApiHandler {
	private mockStream: ApiStreamChunk[]

	constructor(mockStream: ApiStreamChunk[]) {
		this.mockStream = mockStream
	}

	async *createMessage(
		_systemPrompt: string,
		_messages: ClineStorageMessage[],
		_tools?: ClineTool[],
		_useResponseApi?: boolean,
	): ApiStream {
		for (const chunk of this.mockStream) {
			yield chunk
		}
	}

	getModel() {
		return {
			id: "test-model",
			info: {
				maxTokens: 4096,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
			},
		}
	}

	// Optional methods
	async getApiStreamUsage() {
		return {
			type: "usage" as const,
			inputTokens: 100,
			outputTokens: 50,
			cacheWriteTokens: 10,
			cacheReadTokens: 5,
			id: "test-usage",
		}
	}

	abort() {
		// Mock abort
	}
}

describe("SanitizedApiHandler", () => {
	describe("stream sanitization", () => {
		it("should apply sanitization to filter empty text chunks", async () => {
			const mockHandler = new MockApiHandler([
				{ type: "text", text: "" }, // should be filtered
				{ type: "text", text: "hello" },
				{ type: "text", text: "" }, // should be filtered
				{ type: "text", text: "world" },
			])

			const wrapper = new SanitizedApiHandler(mockHandler)
			const stream = wrapper.createMessage("system", [])
			const result = await streamToArray(stream)

			result.should.have.length(2)
			result[0].should.deepEqual({ type: "text", text: "hello" })
			result[1].should.deepEqual({ type: "text", text: "world" })
		})

		it("should apply sanitization to filter empty reasoning chunks", async () => {
			const mockHandler = new MockApiHandler([
				{ type: "reasoning", reasoning: "", id: "r1" }, // should be filtered
				{ type: "reasoning", reasoning: "thinking", id: "r2" },
				{ type: "reasoning", reasoning: "", id: "r3" }, // should be filtered
			])

			const wrapper = new SanitizedApiHandler(mockHandler)
			const stream = wrapper.createMessage("system", [])
			const result = await streamToArray(stream)

			result.should.have.length(1)
			result[0].should.deepEqual({ type: "reasoning", reasoning: "thinking", id: "r2" })
		})

		it("should pass through non-empty chunks unchanged", async () => {
			const mockHandler = new MockApiHandler([
				{ type: "text", text: "hello" },
				{ type: "reasoning", reasoning: "thinking", id: "r1" },
				{ type: "usage", inputTokens: 100, outputTokens: 50 },
			])

			const wrapper = new SanitizedApiHandler(mockHandler)
			const stream = wrapper.createMessage("system", [])
			const result = await streamToArray(stream)

			result.should.have.length(3)
			result[0].should.deepEqual({ type: "text", text: "hello" })
			result[1].should.deepEqual({ type: "reasoning", reasoning: "thinking", id: "r1" })
			result[2].should.deepEqual({ type: "usage", inputTokens: 100, outputTokens: 50 })
		})

		it("should NOT filter whitespace-only chunks (sanitize-stream behavior)", async () => {
			const mockHandler = new MockApiHandler([
				{ type: "text", text: " " },
				{ type: "text", text: "\n" },
				{ type: "reasoning", reasoning: "   ", id: "r1" },
			])

			const wrapper = new SanitizedApiHandler(mockHandler)
			const stream = wrapper.createMessage("system", [])
			const result = await streamToArray(stream)

			// Whitespace is intentionally NOT filtered
			result.should.have.length(3)
		})
	})

	describe("delegation to underlying handler", () => {
		it("should delegate createMessage call to underlying handler", async () => {
			let callCount = 0
			const mockHandler = new MockApiHandler([{ type: "text", text: "test" }])
			const originalCreateMessage = mockHandler.createMessage.bind(mockHandler)
			mockHandler.createMessage = async function* (...args) {
				callCount++
				yield* originalCreateMessage(...args)
			}

			const wrapper = new SanitizedApiHandler(mockHandler)
			const stream = wrapper.createMessage("test system", [], undefined, false)
			await streamToArray(stream)

			callCount.should.equal(1)
		})

		it("should pass systemPrompt to underlying handler", async () => {
			let capturedSystemPrompt: string | undefined
			const mockHandler = new MockApiHandler([{ type: "text", text: "test" }])
			const originalCreateMessage = mockHandler.createMessage.bind(mockHandler)
			mockHandler.createMessage = async function* (systemPrompt, messages, tools, useResponseApi) {
				capturedSystemPrompt = systemPrompt
				yield* originalCreateMessage(systemPrompt, messages, tools, useResponseApi)
			}

			const wrapper = new SanitizedApiHandler(mockHandler)
			const stream = wrapper.createMessage("my system prompt", [])
			await streamToArray(stream)

			capturedSystemPrompt!.should.equal("my system prompt")
		})

		it("should pass messages to underlying handler", async () => {
			let capturedMessages: ClineStorageMessage[] | undefined
			const mockHandler = new MockApiHandler([{ type: "text", text: "test" }])
			const originalCreateMessage = mockHandler.createMessage.bind(mockHandler)
			mockHandler.createMessage = async function* (systemPrompt, messages, tools, useResponseApi) {
				capturedMessages = messages
				yield* originalCreateMessage(systemPrompt, messages, tools, useResponseApi)
			}

			const testMessages: ClineStorageMessage[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: [{ type: "text", text: "Hi" }] },
			]

			const wrapper = new SanitizedApiHandler(mockHandler)
			const stream = wrapper.createMessage("system", testMessages)
			await streamToArray(stream)

			capturedMessages!.should.deepEqual(testMessages)
		})

		it("should pass tools to underlying handler", async () => {
			let capturedTools: ClineTool[] | undefined
			const mockHandler = new MockApiHandler([{ type: "text", text: "test" }])
			const originalCreateMessage = mockHandler.createMessage.bind(mockHandler)
			mockHandler.createMessage = async function* (systemPrompt, messages, tools, useResponseApi) {
				capturedTools = tools
				yield* originalCreateMessage(systemPrompt, messages, tools, useResponseApi)
			}

			const testTools: ClineTool[] = [
				{
					name: "read_file",
					description: "Read a file",
					input_schema: { type: "object", properties: {} },
				},
			]

			const wrapper = new SanitizedApiHandler(mockHandler)
			const stream = wrapper.createMessage("system", [], testTools)
			await streamToArray(stream)

			capturedTools!.should.deepEqual(testTools)
		})

		it("should pass useResponseApi flag to underlying handler", async () => {
			let capturedUseResponseApi: boolean | undefined
			const mockHandler = new MockApiHandler([{ type: "text", text: "test" }])
			const originalCreateMessage = mockHandler.createMessage.bind(mockHandler)
			mockHandler.createMessage = async function* (systemPrompt, messages, tools, useResponseApi) {
				capturedUseResponseApi = useResponseApi
				yield* originalCreateMessage(systemPrompt, messages, tools, useResponseApi)
			}

			const wrapper = new SanitizedApiHandler(mockHandler)
			const stream = wrapper.createMessage("system", [], undefined, true)
			await streamToArray(stream)

			capturedUseResponseApi!.should.be.true()
		})
	})

	describe("getModel delegation", () => {
		it("should delegate getModel to underlying handler", () => {
			const mockHandler = new MockApiHandler([])
			const wrapper = new SanitizedApiHandler(mockHandler)

			const model = wrapper.getModel()

			model.id.should.equal("test-model")
			model.info.maxTokens!.should.equal(4096)
		})
	})

	describe("optional method delegation", () => {
		it("should delegate getApiStreamUsage to underlying handler", async () => {
			const mockHandler = new MockApiHandler([])
			const wrapper = new SanitizedApiHandler(mockHandler)

			const usage = await wrapper.getApiStreamUsage()

			usage!.inputTokens.should.equal(100)
			usage!.outputTokens.should.equal(50)
		})

		it("should handle missing getApiStreamUsage gracefully", async () => {
			// Create handler without getApiStreamUsage method
			const handlerWithoutUsage: ApiHandler = {
				async *createMessage() {
					yield { type: "text", text: "test" }
				},
				getModel() {
					return {
						id: "test",
						info: {
							maxTokens: 4096,
							contextWindow: 200000,
							supportsPromptCache: true,
						},
					}
				},
			}

			const wrapper = new SanitizedApiHandler(handlerWithoutUsage)
			const usage = await wrapper.getApiStreamUsage()

			// Should return undefined when method is missing
			should.not.exist(usage)
		})

		it("should delegate abort to underlying handler", () => {
			let abortCalled = false
			const mockHandler = new MockApiHandler([])
			mockHandler.abort = () => {
				abortCalled = true
			}

			const wrapper = new SanitizedApiHandler(mockHandler)
			wrapper.abort()

			abortCalled.should.be.true()
		})

		it("should handle missing abort gracefully", () => {
			const mockHandler = new MockApiHandler([])
			delete (mockHandler as any).abort

			const wrapper = new SanitizedApiHandler(mockHandler)

			// Should not throw
			const result = wrapper.abort()
			;(result === undefined).should.be.true()
		})
	})

	describe("error propagation", () => {
		it("should propagate errors from underlying handler", async () => {
			class ErrorHandler implements ApiHandler {
				async *createMessage(): ApiStream {
					throw new Error("Test error")
				}
				getModel() {
					return {
						id: "test",
						info: {
							maxTokens: 4096,
							contextWindow: 200000,
							supportsPromptCache: true,
						},
					}
				}
			}

			const mockHandler = new ErrorHandler()
			const wrapper = new SanitizedApiHandler(mockHandler)

			let caughtError: Error | undefined
			try {
				const stream = wrapper.createMessage("system", [])
				await streamToArray(stream)
			} catch (error) {
				caughtError = error as Error
			}

			caughtError!.message.should.equal("Test error")
		})

		it("should propagate errors from sanitization layer", async () => {
			// Create a handler that yields a chunk, then throws
			class ThrowingHandler implements ApiHandler {
				async *createMessage(): ApiStream {
					yield { type: "text", text: "before error" }
					throw new Error("Stream error")
				}
				getModel() {
					return {
						id: "test",
						info: {
							maxTokens: 4096,
							contextWindow: 200000,
							supportsPromptCache: true,
						},
					}
				}
			}

			const mockHandler = new ThrowingHandler()
			const wrapper = new SanitizedApiHandler(mockHandler)

			let caughtError: Error | undefined
			const chunks: ApiStreamChunk[] = []
			try {
				const stream = wrapper.createMessage("system", [])
				for await (const chunk of stream) {
					chunks.push(chunk)
				}
			} catch (error) {
				caughtError = error as Error
			}

			chunks.should.have.length(1)
			chunks[0].should.deepEqual({ type: "text", text: "before error" })
			caughtError!.message.should.equal("Stream error")
		})
	})

	describe("integration with sanitization", () => {
		it("should combine handler output with sanitization correctly", async () => {
			const mockHandler = new MockApiHandler([
				{ type: "text", text: "" }, // filtered by sanitization
				{ type: "usage", inputTokens: 100, outputTokens: 50 },
				{ type: "text", text: "Hello" },
				{ type: "reasoning", reasoning: "", id: "r1" }, // filtered by sanitization
				{ type: "reasoning", reasoning: "thinking", id: "r2" },
				{ type: "text", text: "" }, // filtered by sanitization
				{ type: "text", text: "world" },
			])

			const wrapper = new SanitizedApiHandler(mockHandler)
			const stream = wrapper.createMessage("system", [])
			const result = await streamToArray(stream)

			// Should have: usage, "Hello", reasoning, "world"
			result.should.have.length(4)
			result[0].type.should.equal("usage")
			result[1].should.deepEqual({ type: "text", text: "Hello" })
			result[2].should.deepEqual({ type: "reasoning", reasoning: "thinking", id: "r2" })
			result[3].should.deepEqual({ type: "text", text: "world" })
		})
	})
})
