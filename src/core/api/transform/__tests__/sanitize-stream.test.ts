import { describe, it } from "mocha"
import "should"
import { sanitizeApiStream } from "../sanitize-stream"
import { ApiStream, ApiStreamChunk } from "../stream"

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
 * Helper to create a mock stream from chunks
 */
async function* createMockStream(chunks: ApiStreamChunk[]): ApiStream {
	for (const chunk of chunks) {
		yield chunk
	}
}

describe("sanitizeApiStream", () => {
	describe("text chunk filtering", () => {
		it("should drop empty string text chunks", async () => {
			const stream = createMockStream([
				{ type: "text", text: "" },
				{ type: "text", text: "hello" },
				{ type: "text", text: "" },
				{ type: "text", text: "world" },
			])

			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(2)
			result[0].should.deepEqual({ type: "text", text: "hello" })
			result[1].should.deepEqual({ type: "text", text: "world" })
		})

		it("should pass through non-empty text chunks", async () => {
			const stream = createMockStream([
				{ type: "text", text: "Hello" },
				{ type: "text", text: " " }, // whitespace-only is NOT filtered (intentional)
				{ type: "text", text: "world" },
			])

			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(3)
			result[0].should.deepEqual({ type: "text", text: "Hello" })
			result[1].should.deepEqual({ type: "text", text: " " })
			result[2].should.deepEqual({ type: "text", text: "world" })
		})

		it("should pass through whitespace-only text chunks (intentional behavior)", async () => {
			const stream = createMockStream([
				{ type: "text", text: "   " },
				{ type: "text", text: "\n" },
				{ type: "text", text: "\t" },
			])

			const result = await streamToArray(sanitizeApiStream(stream))

			// Whitespace-only chunks are NOT filtered because providers may send meaningful spacing
			result.should.have.length(3)
			result[0].should.deepEqual({ type: "text", text: "   " })
			result[1].should.deepEqual({ type: "text", text: "\n" })
			result[2].should.deepEqual({ type: "text", text: "\t" })
		})

		it("should drop text chunks with non-string text values", async () => {
			const stream = createMockStream([
				{ type: "text", text: "valid" },
				{ type: "text", text: null as any },
				{ type: "text", text: undefined as any },
				{ type: "text", text: 123 as any },
			])

			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(1)
			result[0].should.deepEqual({ type: "text", text: "valid" })
		})
	})

	describe("reasoning chunk filtering", () => {
		it("should drop empty string reasoning chunks", async () => {
			const stream = createMockStream([
				{ type: "reasoning", reasoning: "", id: "r1" },
				{ type: "reasoning", reasoning: "thinking about it", id: "r2" },
				{ type: "reasoning", reasoning: "", id: "r3" },
			])

			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(1)
			result[0].should.deepEqual({ type: "reasoning", reasoning: "thinking about it", id: "r2" })
		})

		it("should pass through non-empty reasoning chunks", async () => {
			const stream = createMockStream([
				{ type: "reasoning", reasoning: "Step 1", id: "r1" },
				{ type: "reasoning", reasoning: "Step 2", id: "r2" },
			])

			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(2)
			result[0].should.deepEqual({ type: "reasoning", reasoning: "Step 1", id: "r1" })
			result[1].should.deepEqual({ type: "reasoning", reasoning: "Step 2", id: "r2" })
		})

		it("should drop reasoning chunks with non-string reasoning values", async () => {
			const stream = createMockStream([
				{ type: "reasoning", reasoning: "valid", id: "r1" },
				{ type: "reasoning", reasoning: null as any, id: "r2" },
				{ type: "reasoning", reasoning: undefined as any, id: "r3" },
			])

			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(1)
			result[0].should.deepEqual({ type: "reasoning", reasoning: "valid", id: "r1" })
		})

		it("should pass through whitespace-only reasoning chunks (like text behavior)", async () => {
			const stream = createMockStream([
				{ type: "reasoning", reasoning: "   ", id: "r1" },
				{ type: "reasoning", reasoning: "\n", id: "r2" },
			])

			const result = await streamToArray(sanitizeApiStream(stream))

			// Consistent with text chunk behavior - whitespace is not filtered
			result.should.have.length(2)
			result[0].should.deepEqual({ type: "reasoning", reasoning: "   ", id: "r1" })
			result[1].should.deepEqual({ type: "reasoning", reasoning: "\n", id: "r2" })
		})
	})

	describe("non-text/reasoning chunks", () => {
		it("should pass through usage chunks unchanged", async () => {
			const stream = createMockStream([
				{
					type: "usage",
					inputTokens: 100,
					outputTokens: 50,
					cacheWriteTokens: 10,
					cacheReadTokens: 5,
				},
			])

			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(1)
			result[0].should.deepEqual({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 10,
				cacheReadTokens: 5,
			})
		})

		it("should pass through tool_calls chunks unchanged", async () => {
			const toolCallChunk = {
				type: "tool_calls" as const,
				tool_call: {
					function: {
						id: "tool_1",
						name: "read_file",
						arguments: '{"path": "test.ts"}',
					},
					call_id: "call_1",
				},
			}

			const stream = createMockStream([toolCallChunk])
			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(1)
			result[0].should.deepEqual(toolCallChunk)
		})

		it("should pass through all chunk types without modification", async () => {
			const chunks: ApiStreamChunk[] = [
				{ type: "usage", inputTokens: 10, outputTokens: 5 },
				{ type: "text", text: "hello" },
				{ type: "reasoning", reasoning: "thinking", id: "r1" },
				{
					type: "tool_calls",
					tool_call: {
						function: { id: "t1", name: "test", arguments: "{}" },
						call_id: "c1",
					},
				},
			]

			const stream = createMockStream(chunks)
			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(4)
			result.should.deepEqual(chunks)
		})
	})

	describe("mixed stream scenarios", () => {
		it("should filter empty text/reasoning while passing through other chunks", async () => {
			const stream = createMockStream([
				{ type: "text", text: "" }, // filtered
				{ type: "usage", inputTokens: 100, outputTokens: 50 },
				{ type: "text", text: "Hello" },
				{ type: "reasoning", reasoning: "", id: "r1" }, // filtered
				{ type: "reasoning", reasoning: "thinking", id: "r2" },
				{ type: "text", text: "" }, // filtered
				{
					type: "tool_calls",
					tool_call: {
						function: { id: "t1", name: "read_file", arguments: '{"path":"test"}' },
						call_id: "c1",
					},
				},
				{ type: "text", text: "world" },
			])

			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(5)
			result[0].should.deepEqual({ type: "usage", inputTokens: 100, outputTokens: 50 })
			result[1].should.deepEqual({ type: "text", text: "Hello" })
			result[2].should.deepEqual({ type: "reasoning", reasoning: "thinking", id: "r2" })
			result[3].should.deepEqual({
				type: "tool_calls",
				tool_call: {
					function: { id: "t1", name: "read_file", arguments: '{"path":"test"}' },
					call_id: "c1",
				},
			})
			result[4].should.deepEqual({ type: "text", text: "world" })
		})

		it("should handle streams with only empty chunks gracefully", async () => {
			const stream = createMockStream([
				{ type: "text", text: "" },
				{ type: "text", text: "" },
				{ type: "reasoning", reasoning: "", id: "r1" },
			])

			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(0)
		})

		it("should handle empty streams", async () => {
			const stream = createMockStream([])
			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(0)
		})
	})

	describe("edge cases", () => {
		it("should handle text chunks with various falsy values", async () => {
			const stream = createMockStream([
				{ type: "text", text: "" }, // filtered
				{ type: "text", text: "0" }, // passed (valid string)
				{ type: "text", text: "false" }, // passed (valid string)
				{ type: "text", text: null as any }, // filtered
				{ type: "text", text: undefined as any }, // filtered
			])

			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(2)
			result[0].should.deepEqual({ type: "text", text: "0" })
			result[1].should.deepEqual({ type: "text", text: "false" })
		})

		it("should preserve chunk metadata when passing through", async () => {
			const stream = createMockStream([
				{
					type: "reasoning",
					reasoning: "thinking",
					id: "r1",
					signature: "sig123",
					details: [{ type: "detail1" }] as any,
					redacted_data: { foo: "bar" } as any,
				},
			])

			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(1)
			result[0].should.deepEqual({
				type: "reasoning",
				reasoning: "thinking",
				id: "r1",
				signature: "sig123",
				details: [{ type: "detail1" }],
				redacted_data: { foo: "bar" },
			})
		})

		it("should handle very long streams efficiently", async () => {
			// Create a stream with many chunks
			const chunks: ApiStreamChunk[] = []
			for (let i = 0; i < 1000; i++) {
				chunks.push({ type: "text", text: i % 2 === 0 ? "" : `chunk${i}` })
			}

			const stream = createMockStream(chunks)
			const result = await streamToArray(sanitizeApiStream(stream))

			// Should only have the non-empty chunks (500 total)
			result.should.have.length(500)
			result.every((chunk) => chunk.type === "text" && chunk.text !== "").should.be.true()
		})
	})

	describe("stream ordering", () => {
		it("should maintain chunk order while filtering", async () => {
			const stream = createMockStream([
				{ type: "text", text: "First" },
				{ type: "text", text: "" }, // filtered
				{ type: "reasoning", reasoning: "Thinking", id: "r1" },
				{ type: "text", text: "" }, // filtered
				{ type: "text", text: "Second" },
				{ type: "reasoning", reasoning: "", id: "r2" }, // filtered
				{ type: "text", text: "Third" },
			])

			const result = await streamToArray(sanitizeApiStream(stream))

			result.should.have.length(4)
			result[0].should.deepEqual({ type: "text", text: "First" })
			result[1].should.deepEqual({ type: "reasoning", reasoning: "Thinking", id: "r1" })
			result[2].should.deepEqual({ type: "text", text: "Second" })
			result[3].should.deepEqual({ type: "text", text: "Third" })
		})
	})
})
