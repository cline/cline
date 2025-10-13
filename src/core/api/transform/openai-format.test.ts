import { Anthropic } from "@anthropic-ai/sdk"
import { expect } from "chai"
import * as sinon from "sinon"
import { convertToAnthropicMessage, convertToOpenAiResponseInput } from "./openai-format"

describe("openai-format transforms", () => {
	let globalErrorStub: sinon.SinonStub
	before(() => {
		// Silence console.error from product code triggered by invalid JSON in this test file
		globalErrorStub = sinon.stub(console, "error")
	})
	after(() => {
		globalErrorStub.restore()
	})
	describe("convertToOpenAiResponseInput", () => {
		it("maps simple user string content to a single input_text message", () => {
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "hello world" }]

			const result = convertToOpenAiResponseInput(messages)

			expect(Array.isArray(result)).to.equal(true)
			expect(result).to.have.length(1)
			expect(result[0]).to.deep.equal({
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "hello world" }],
			})
		})

		it("maps user array content with text and image blocks", () => {
			const img: Anthropic.Messages.ImageBlockParam = {
				type: "image",
				source: { type: "base64", media_type: "image/png", data: "BASE64DATA" },
			}
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [{ type: "text", text: "hi" }, img],
				},
			]

			const result = convertToOpenAiResponseInput(messages)

			expect(result).to.have.length(1)
			expect(result[0]).to.deep.equal({
				type: "message",
				role: "user",
				content: [
					{ type: "input_text", text: "hi" },
					{
						type: "input_image",
						image_url: "data:image/png;base64,BASE64DATA",
						detail: "auto",
					},
				],
			})
		})

		it("emits tool_result images as a separate user message and text as input_text", () => {
			const toolResult: Anthropic.ToolResultBlockParam = {
				type: "tool_result",
				tool_use_id: "call-1",
				content: [
					{ type: "text", text: "image follows" },
					{
						type: "image",
						source: { type: "base64", media_type: "image/jpeg", data: "IMGDATA" },
					},
				],
			}

			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [toolResult],
				},
			]

			const result = convertToOpenAiResponseInput(messages)

			// Expect 2 messages:
			// - one user message with the image
			// - one user message with the input_text parts
			expect(result).to.have.length(2)

			// First: image message
			expect(result[0]).to.deep.equal({
				type: "message",
				role: "user",
				content: [
					{
						type: "input_image",
						image_url: "data:image/jpeg;base64,IMGDATA",
						detail: "auto",
					},
				],
			})

			// Second: text message (placeholder from tool result)
			expect(result[1]).to.deep.equal({
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "(see following user message for image)" }],
			})
		})

		it("emits assistant tool_use as function_call followed by assistant output_text", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tu-1",
							name: "do_something",
							input: { a: 1, b: "x" },
						},
						{
							type: "text",
							text: "done",
						},
					],
				},
			]

			const result = convertToOpenAiResponseInput(messages)

			// Expect 2 items: function_call and completed assistant message
			expect(result.length).to.equal(2)

			const fc = result[0] as any
			expect(fc.type).to.equal("function_call")
			expect(fc.name).to.equal("do_something")
			expect(fc.arguments).to.equal(JSON.stringify({ a: 1, b: "x" }))
			expect(typeof fc.call_id).to.equal("string")

			const assistantMsg = result[1] as any
			expect(assistantMsg.type).to.equal("message")
			expect(assistantMsg.role).to.equal("assistant")
			expect(assistantMsg.status).to.equal("completed")
			expect(assistantMsg.content).to.deep.equal([{ type: "output_text", text: "done", annotations: [] }])
		})
	})

	describe("convertToAnthropicMessage", () => {
		it("filters and maps ChatCompletion.tool_calls to Anthropic tool_use blocks with parsed JSON", () => {
			const completion: any = {
				id: "cmpl-123",
				model: "gpt-4o",
				usage: { prompt_tokens: 5, completion_tokens: 7 },
				choices: [
					{
						finish_reason: "tool_calls",
						message: {
							role: "assistant",
							content: "text content",
							tool_calls: [
								{
									id: "call-1",
									type: "function",
									function: { name: "sum", arguments: JSON.stringify({ x: 1, y: 2 }) },
								},
								// a malformed or unsupported call should be ignored by filter
								{
									id: "call-2",
									type: "not_a_function",
									function: { name: "noop", arguments: "{}" },
								},
							],
						},
					},
				],
			}

			const msg = convertToAnthropicMessage(completion)
			// base text
			expect(msg.content[0]).to.deep.include({ type: "text", text: "text content" })
			// mapped tool_use
			const toolUse = msg.content.find((p: any) => p.type === "tool_use") as Anthropic.ToolUseBlockParam | undefined
			expect(toolUse).to.exist
			expect(toolUse!).to.deep.include({
				id: "call-1",
				name: "sum",
				type: "tool_use",
			})
			expect(toolUse!.input).to.deep.equal({ x: 1, y: 2 })
			// ensure the non-function call is filtered out
			const toolUseIds = msg.content.filter((p: any) => p.type === "tool_use").map((p: any) => p.id)
			expect(toolUseIds).to.deep.equal(["call-1"])
		})

		it("handles invalid JSON tool arguments gracefully", () => {
			const completion: any = {
				id: "cmpl-456",
				model: "gpt-4o",
				usage: { prompt_tokens: 1, completion_tokens: 2 },
				choices: [
					{
						finish_reason: "tool_calls",
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call-1",
									type: "function",
									function: { name: "bad", arguments: "invalid json" },
								},
							],
						},
					},
				],
			}

			const msg = convertToAnthropicMessage(completion)
			const toolUse = msg.content.find((p: any) => p.type === "tool_use") as Anthropic.ToolUseBlockParam | undefined
			expect(toolUse).to.exist
			// falls back to {} on parse failure
			expect(toolUse!.input).to.deep.equal({})
		})
	})
})
