import { expect } from "chai"
import { describe, it } from "mocha"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { convertOpenAIToolsToAnthropicTools, handleAnthropicMessagesApiStreamResponse } from "../messages_api_support"

const createAsyncIterable = (events: any[]) =>
	({
		async *[Symbol.asyncIterator]() {
			for (const event of events) {
				yield event
			}
		},
	}) as any

async function collectChunks(events: any[]) {
	const chunks: any[] = []
	for await (const chunk of handleAnthropicMessagesApiStreamResponse(createAsyncIterable(events))) {
		chunks.push(chunk)
	}
	return chunks
}

describe("messages_api_support", () => {
	describe("convertOpenAIToolsToAnthropicTools", () => {
		it("returns undefined when tools are missing", () => {
			expect(convertOpenAIToolsToAnthropicTools(undefined)).to.equal(undefined)
			expect(convertOpenAIToolsToAnthropicTools([])).to.equal(undefined)
		})

		it("converts function tools and defaults schema type to object", () => {
			const tools: OpenAITool[] = [
				{
					type: "function",
					function: {
						name: "read_file",
						description: "Read a file from disk",
						parameters: {
							properties: {
								path: { type: "string" },
							},
							required: ["path"],
						},
					},
				},
			]

			const converted = convertOpenAIToolsToAnthropicTools(tools)

			expect(converted).to.deep.equal([
				{
					name: "read_file",
					description: "Read a file from disk",
					input_schema: {
						type: "object",
						properties: {
							path: { type: "string" },
						},
						required: ["path"],
					},
				},
			])
		})

		it("filters out invalid tools", () => {
			const tools = [
				{
					type: "other",
					function: {
						name: "ignored",
					},
				},
				{
					type: "function",
					function: {
						name: "",
					},
				},
				{
					type: "function",
					function: {
						name: "valid_tool",
						parameters: { type: "object", properties: {} },
					},
				},
			] as any as OpenAITool[]

			const converted = convertOpenAIToolsToAnthropicTools(tools)

			expect(converted).to.have.length(1)
			expect(converted?.[0]?.name).to.equal("valid_tool")
		})
	})

	describe("handleAnthropicMessagesApiStreamResponse", () => {
		it("maps usage, reasoning, and text events into ApiStream chunks", async () => {
			const chunks = await collectChunks([
				{
					type: "message_start",
					message: {
						usage: {
							input_tokens: 10,
							output_tokens: 2,
							cache_creation_input_tokens: 4,
							cache_read_input_tokens: 3,
						},
					},
				},
				{
					type: "content_block_start",
					content_block: {
						type: "thinking",
						thinking: "first thought",
						signature: "sig-start",
					},
					index: 0,
				},
				{
					type: "content_block_delta",
					delta: {
						type: "thinking_delta",
						thinking: " then more",
					},
				},
				{
					type: "content_block_delta",
					delta: {
						type: "signature_delta",
						signature: "sig-final",
					},
				},
				{
					type: "content_block_start",
					content_block: {
						type: "text",
						text: "Hello",
					},
					index: 0,
				},
				{
					type: "content_block_start",
					content_block: {
						type: "text",
						text: "World",
					},
					index: 1,
				},
				{
					type: "message_delta",
					usage: {
						output_tokens: 9,
					},
				},
			])

			expect(chunks).to.deep.equal([
				{
					type: "usage",
					inputTokens: 10,
					outputTokens: 2,
					cacheWriteTokens: 4,
					cacheReadTokens: 3,
				},
				{
					type: "reasoning",
					reasoning: "first thought",
					signature: "sig-start",
				},
				{
					type: "reasoning",
					reasoning: " then more",
				},
				{
					type: "reasoning",
					reasoning: "",
					signature: "sig-final",
				},
				{
					type: "text",
					text: "Hello",
				},
				{
					type: "text",
					text: "\n",
				},
				{
					type: "text",
					text: "World",
				},
				{
					type: "usage",
					inputTokens: 0,
					outputTokens: 9,
				},
			])
		})

		it("emits tool call chunks and resets tool state on block stop", async () => {
			const chunks = await collectChunks([
				{
					type: "content_block_start",
					content_block: {
						type: "tool_use",
						id: "tool_1",
						name: "read_file",
					},
					index: 0,
				},
				{
					type: "content_block_delta",
					delta: {
						type: "input_json_delta",
						partial_json: '{"path":',
					},
				},
				{
					type: "content_block_stop",
				},
				{
					type: "content_block_delta",
					delta: {
						type: "input_json_delta",
						partial_json: '"ignored-after-stop"}',
					},
				},
			])

			expect(chunks).to.have.length(1)
			expect(chunks[0]).to.deep.equal({
				type: "tool_calls",
				tool_call: {
					id: "tool_1",
					name: "read_file",
					arguments: "",
					function: {
						id: "tool_1",
						name: "read_file",
						arguments: '{"path":',
					},
				},
			})
		})
	})
})
