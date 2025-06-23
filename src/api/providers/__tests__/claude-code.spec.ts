import { describe, test, expect, vi, beforeEach } from "vitest"
import { ClaudeCodeHandler } from "../claude-code"
import { ApiHandlerOptions } from "../../../shared/api"

// Mock the runClaudeCode function
vi.mock("../../../integrations/claude-code/run", () => ({
	runClaudeCode: vi.fn(),
}))

const { runClaudeCode } = await import("../../../integrations/claude-code/run")
const mockRunClaudeCode = vi.mocked(runClaudeCode)

// Mock the EventEmitter for the process
class MockEventEmitter {
	private handlers: { [event: string]: ((...args: any[]) => void)[] } = {}

	on(event: string, handler: (...args: any[]) => void) {
		if (!this.handlers[event]) {
			this.handlers[event] = []
		}
		this.handlers[event].push(handler)
	}

	emit(event: string, ...args: any[]) {
		if (this.handlers[event]) {
			this.handlers[event].forEach((handler) => handler(...args))
		}
	}
}

describe("ClaudeCodeHandler", () => {
	let handler: ClaudeCodeHandler
	let mockProcess: any

	beforeEach(() => {
		const options: ApiHandlerOptions = {
			claudeCodePath: "claude",
			apiModelId: "claude-3-5-sonnet-20241022",
		}
		handler = new ClaudeCodeHandler(options)

		const mainEmitter = new MockEventEmitter()
		mockProcess = {
			stdout: new MockEventEmitter(),
			stderr: new MockEventEmitter(),
			on: mainEmitter.on.bind(mainEmitter),
			emit: mainEmitter.emit.bind(mainEmitter),
		}

		mockRunClaudeCode.mockReturnValue(mockProcess)
	})

	test("should handle thinking content properly", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Start the stream
		const stream = handler.createMessage(systemPrompt, messages)
		const streamGenerator = stream[Symbol.asyncIterator]()

		// Simulate thinking content response
		const thinkingResponse = {
			type: "assistant",
			message: {
				id: "msg_123",
				type: "message",
				role: "assistant",
				model: "claude-3-5-sonnet-20241022",
				content: [
					{
						type: "thinking",
						thinking: "I need to think about this carefully...",
						signature: "abc123",
					},
				],
				stop_reason: null,
				stop_sequence: null,
				usage: {
					input_tokens: 10,
					output_tokens: 20,
					service_tier: "standard" as const,
				},
			},
			session_id: "session_123",
		}

		// Emit the thinking response and wait for processing
		setImmediate(() => {
			mockProcess.stdout.emit("data", JSON.stringify(thinkingResponse) + "\n")
			setImmediate(() => {
				mockProcess.emit("close", 0)
			})
		})

		// Get the result
		const result = await streamGenerator.next()

		expect(result.done).toBe(false)
		expect(result.value).toEqual({
			type: "reasoning",
			text: "I need to think about this carefully...",
		})
	})

	test("should handle mixed content types", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		const stream = handler.createMessage(systemPrompt, messages)
		const streamGenerator = stream[Symbol.asyncIterator]()

		// Simulate mixed content response
		const mixedResponse = {
			type: "assistant",
			message: {
				id: "msg_123",
				type: "message",
				role: "assistant",
				model: "claude-3-5-sonnet-20241022",
				content: [
					{
						type: "thinking",
						thinking: "Let me think about this...",
					},
					{
						type: "text",
						text: "Here's my response!",
					},
				],
				stop_reason: null,
				stop_sequence: null,
				usage: {
					input_tokens: 10,
					output_tokens: 20,
					service_tier: "standard" as const,
				},
			},
			session_id: "session_123",
		}

		// Emit the mixed response and wait for processing
		setImmediate(() => {
			mockProcess.stdout.emit("data", JSON.stringify(mixedResponse) + "\n")
			setImmediate(() => {
				mockProcess.emit("close", 0)
			})
		})

		// Get the first result (thinking)
		const thinkingResult = await streamGenerator.next()
		expect(thinkingResult.done).toBe(false)
		expect(thinkingResult.value).toEqual({
			type: "reasoning",
			text: "Let me think about this...",
		})

		// Get the second result (text)
		const textResult = await streamGenerator.next()
		expect(textResult.done).toBe(false)
		expect(textResult.value).toEqual({
			type: "text",
			text: "Here's my response!",
		})
	})

	test("should handle stop_reason with thinking content in error messages", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		const stream = handler.createMessage(systemPrompt, messages)
		const streamGenerator = stream[Symbol.asyncIterator]()

		// Simulate error response with thinking content
		const errorResponse = {
			type: "assistant",
			message: {
				id: "msg_123",
				type: "message",
				role: "assistant",
				model: "claude-3-5-sonnet-20241022",
				content: [
					{
						type: "thinking",
						thinking: "This is an error scenario",
					},
				],
				stop_reason: "max_tokens",
				stop_sequence: null,
				usage: {
					input_tokens: 10,
					output_tokens: 20,
					service_tier: "standard" as const,
				},
			},
			session_id: "session_123",
		}

		// Emit the error response and wait for processing
		setImmediate(() => {
			mockProcess.stdout.emit("data", JSON.stringify(errorResponse) + "\n")
			setImmediate(() => {
				mockProcess.emit("close", 0)
			})
		})

		// Should throw error with thinking content
		await expect(streamGenerator.next()).rejects.toThrow("This is an error scenario")
	})

	test("should handle incomplete JSON in buffer on process close", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		const stream = handler.createMessage(systemPrompt, messages)
		const streamGenerator = stream[Symbol.asyncIterator]()

		// Simulate incomplete JSON data followed by process close
		setImmediate(() => {
			// Send incomplete JSON (missing closing brace)
			mockProcess.stdout.emit("data", '{"type":"assistant","message":{"id":"msg_123"')
			setImmediate(() => {
				mockProcess.emit("close", 0)
			})
		})

		// Should complete without throwing, incomplete JSON should be discarded
		const result = await streamGenerator.next()
		expect(result.done).toBe(true)
	})
})
