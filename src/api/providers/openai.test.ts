import { describe, it } from "mocha"
import "should"
import { OpenAiHandler } from "./openai"
import { ApiHandlerOptions, azureOpenAiDefaultApiVersion, ModelInfo } from "../../shared/api"
import { ApiStreamTextChunk, ApiStreamUsageChunk } from "../transform/stream"
import OpenAI, { AzureOpenAI } from "openai"
import { Anthropic } from "@anthropic-ai/sdk"

// Mock OpenAI client
class MockOpenAIClient {
	chat = {
		completions: {
			create: async function* () {
				yield {
					choices: [{ delta: { content: "test response" } }],
					usage: {
						prompt_tokens: 100,
						completion_tokens: 50,
					},
				}
			},
		},
	}
}

describe("OpenAI Provider", () => {
	describe("Constructor", () => {
		it("should initialize regular OpenAI client", () => {
			const options: ApiHandlerOptions = {
				openAiApiKey: "test-key",
				openAiBaseUrl: "https://api.openai.com/v1",
			}
			const handler = new OpenAiHandler(options)
			// @ts-ignore - accessing private property for testing
			handler.client.should.be.instanceof(OpenAI)
		})

		it("should initialize Azure OpenAI client", () => {
			const options: ApiHandlerOptions = {
				openAiApiKey: "test-key",
				openAiBaseUrl: "https://test.azure.com",
				azureApiVersion: "2024-02-01",
			}
			const handler = new OpenAiHandler(options)
			// @ts-ignore - accessing private property for testing
			handler.client.should.be.instanceof(OpenAI)
			// @ts-ignore - accessing private property for testing
			handler.client.baseURL.should.equal(options.openAiBaseUrl)
		})

		it("should use default Azure API version if not provided", () => {
			const options: ApiHandlerOptions = {
				openAiApiKey: "test-key",
				openAiBaseUrl: "https://test.azure.com",
			}
			const handler = new OpenAiHandler(options)
			// @ts-ignore - accessing private property for testing
			const client = handler.client as AzureOpenAI
			client.apiVersion.should.equal(azureOpenAiDefaultApiVersion)
		})
	})

	describe("createMessage", () => {
		it("should stream messages without prompt caching", async () => {
			const options: ApiHandlerOptions = {
				openAiApiKey: "test-key",
				openAiModelId: "gpt-4",
				openAiSupportsPromptCache: false,
			}
			const handler = new OpenAiHandler(options)
			// @ts-ignore - replace client with mock
			handler.client = new MockOpenAIClient()

			const systemPrompt = "You are a helpful assistant"
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

			const stream = handler.createMessage(systemPrompt, messages)
			const results = []
			for await (const chunk of stream) {
				results.push(chunk)
			}

			results.should.have.length(2) // text chunk and usage info
			const textChunk = results[0] as ApiStreamTextChunk
			textChunk.should.deepEqual({ type: "text", text: "test response" })
			results[1].should.deepEqual({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
			})
		})

		it("should stream messages with prompt caching", async () => {
			const options: ApiHandlerOptions = {
				openAiApiKey: "test-key",
				openAiModelId: "gpt-4",
				openAiSupportsPromptCache: true,
			}
			const handler = new OpenAiHandler(options)
			// @ts-ignore - replace client with mock
			handler.client = new MockOpenAIClient()

			const systemPrompt = "You are a helpful assistant"
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi" },
				{ role: "user", content: "How are you?" },
			]

			const stream = handler.createMessage(systemPrompt, messages)
			const results = []
			for await (const chunk of stream) {
				results.push(chunk)
			}

			results.should.have.length(3) // text chunk, usage info, and api request info
			results[0].should.deepEqual({ type: "text", text: "test response" })
			results[1].should.deepEqual({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 20, // 20% of input tokens
				cacheReadTokens: 10, // 10% of input tokens
			})
			const apiReqChunk = results[2] as ApiStreamTextChunk
			apiReqChunk.should.have.property("type", "text")
			const apiReqInfo = JSON.parse(apiReqChunk.text)
			apiReqInfo.should.have.property("say", "api_req_started")
			apiReqInfo.usage.should.deepEqual({
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 20,
				cacheReadTokens: 10,
			})
		})
	})

	describe("getModel", () => {
		it("should return model info without computer use and prompt cache support", () => {
			const options: ApiHandlerOptions = {
				openAiApiKey: "test-key",
				openAiModelId: "gpt-4",
			}
			const handler = new OpenAiHandler(options)
			const model = handler.getModel()

			model.id.should.equal("gpt-4")
			const info = model.info as ModelInfo
			info.should.have.property("supportsComputerUse", false)
			info.should.have.property("supportsPromptCache", false)
			info.should.not.have.property("cacheWritesPrice")
			info.should.not.have.property("cacheReadsPrice")
		})

		it("should return model info with computer use and prompt cache support", () => {
			const options: ApiHandlerOptions = {
				openAiApiKey: "test-key",
				openAiModelId: "gpt-4",
				openAiSupportsComputerUse: true,
				openAiSupportsPromptCache: true,
			}
			const handler = new OpenAiHandler(options)
			const model = handler.getModel()

			model.id.should.equal("gpt-4")
			const info = model.info as ModelInfo
			info.should.have.property("supportsComputerUse", true)
			info.should.have.property("supportsPromptCache", true)
			info.should.have.property("cacheWritesPrice", 3.75)
			info.should.have.property("cacheReadsPrice", 0.3)
		})
	})
})
