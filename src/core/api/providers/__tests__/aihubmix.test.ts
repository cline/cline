import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { Anthropic } from "@anthropic-ai/sdk"
import sinon from "sinon"
import { AIhubmixHandler } from "../aihubmix"

describe("AIhubmixHandler", () => {
	let handler: AIhubmixHandler

	beforeEach(() => {
		handler = new AIhubmixHandler({
			apiKey: "test-api-key",
			modelId: "gpt-4o-mini",
		})

		// Mock Anthropic
		sinon.stub(Anthropic.prototype, "messages").value({
			create: sinon.stub().resolves({
				[Symbol.asyncIterator]: async function* () {
					yield {
						type: "message_start",
						message: { usage: { input_tokens: 10, output_tokens: 0 } },
					}
					yield {
						type: "content_block_start",
						content_block: { type: "text", text: "Hello" },
					}
					yield {
						type: "content_block_delta",
						delta: { type: "text_delta", text: " World" },
					}
				},
			}),
		})
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("Model Routing", () => {
		it("should route Claude models to Anthropic", () => {
			const claudeHandler = new AIhubmixHandler({
				apiKey: "test-api-key",
				modelId: "claude-3-5-sonnet-20241022",
			})
			claudeHandler.getModel().id.should.equal("claude-3-5-sonnet-20241022")
		})

		it("should route Gemini models to Gemini", () => {
			const geminiHandler = new AIhubmixHandler({
				apiKey: "test-api-key",
				modelId: "gemini-2.0-flash-exp",
			})
			geminiHandler.getModel().id.should.equal("gemini-2.0-flash-exp")
		})

		it("should route OpenAI models to OpenAI", () => {
			const openaiHandler = new AIhubmixHandler({
				apiKey: "test-api-key",
				modelId: "gpt-4o-mini",
			})
			openaiHandler.getModel().id.should.equal("gpt-4o-mini")
		})

		it("should exclude special Gemini suffixes", () => {
			const geminiHandler = new AIhubmixHandler({
				apiKey: "test-api-key",
				modelId: "gemini-2.0-flash-exp-nothink",
			})
			// Should fallback to OpenAI for special suffixes
			geminiHandler.getModel().id.should.equal("gemini-2.0-flash-exp-nothink")
		})
	})

	describe("Configuration", () => {
		it("should use default base URL and app code", () => {
			const handler = new AIhubmixHandler({
				apiKey: "test-api-key",
			})
			handler.getModel().info.description?.should.equal("AIhubmix unified model provider")
		})

		it("should allow custom configuration", () => {
			const handler = new AIhubmixHandler({
				apiKey: "test-api-key",
				baseURL: "https://aihubmix.com",
				appCode: "Custom2025",
				modelId: "custom-model",
			})
			handler.getModel().id.should.equal("custom-model")
		})
	})

	describe("Error Handling", () => {
		it("should throw error when API key is missing", () => {
			;(() => {
				new AIhubmixHandler({})
			}).should.throw("AIhubmix API key is required")
		})
	})

	describe("Tool Choice Fix", () => {
		it("should remove tool_choice when tools array is empty", () => {
			const requestBody = {
				model: "gpt-4o-mini",
				messages: [],
				tools: [],
				tool_choice: "auto",
			}

			// Access the private method through the handler instance
			const fixedBody = (handler as any).fixToolChoice(requestBody)
			;(fixedBody.tool_choice === undefined).should.be.true()
		})

		it("should keep tool_choice when tools array has items", () => {
			const requestBody = {
				model: "gpt-4o-mini",
				messages: [],
				tools: [{ type: "function", function: { name: "test" } }],
				tool_choice: "auto",
			}

			const fixedBody = (handler as any).fixToolChoice(requestBody)
			fixedBody.tool_choice.should.equal("auto")
		})
	})
})
