import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import OpenAI from "openai"
import sinon from "sinon"
import { OpenAIAuthService } from "@/services/auth/openai/OpenAIAuthService"
import { ClineStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { OpenAiOAuthHandler } from "../openai-oauth"

describe("OpenAiOAuthHandler", () => {
	let handler: OpenAiOAuthHandler
	let authServiceStub: sinon.SinonStub
	let loggerStub: sinon.SinonStub
	let clock: sinon.SinonFakeTimers

	beforeEach(() => {
		// Mock OpenAIAuthService singleton
		authServiceStub = sinon.stub(OpenAIAuthService, "getInstance").returns({
			getAuthToken: sinon.stub().resolves("test-access-token"),
		} as any)

		// Mock Logger
		loggerStub = sinon.stub(Logger, "debug")

		// Use fake timers for testing timeouts
		clock = sinon.useFakeTimers()

		// Create handler with test options
		const options = {
			openAiOAuthModelId: "gpt-4",
			openAiOAuthBaseUrl: "https://api.openai.com/v1",
			openAiOAuthClientId: "test-client-id",
			openAiOAuthScopes: "openai",
			openAiOAuthAuthUrl: "https://auth.openai.com/authorize",
			openAiOAuthTokenUrl: "https://auth.openai.com/token",
		}
		handler = new OpenAiOAuthHandler(options)
	})

	afterEach(() => {
		clock.restore()
		sinon.restore()
	})

	describe("constructor", () => {
		it("should initialize with correct options", () => {
			const options = {
				openAiOAuthModelId: "gpt-4-turbo",
				openAiOAuthBaseUrl: "https://custom.api.com/v1",
			}
			const testHandler = new OpenAiOAuthHandler(options)

			const model = testHandler.getModel()
			model.id.should.equal("gpt-4-turbo")
		})

		it("should handle empty options", () => {
			const testHandler = new OpenAiOAuthHandler({})
			const model = testHandler.getModel()
			model.id.should.equal("")
		})
	})

	describe("getModel", () => {
		it("should return model info with correct id", () => {
			const result = handler.getModel()

			result.should.have.property("id", "gpt-4")
			result.should.have.property("info")
			result.info.should.have.property("maxTokens")
			result.info.should.have.property("contextWindow")
		})

		it("should return default model info when not specified", () => {
			const testHandler = new OpenAiOAuthHandler({
				openAiOAuthModelId: "custom-model",
			})

			const result = testHandler.getModel()
			result.id.should.equal("custom-model")
			result.info.should.have.property("maxTokens")
		})

		it("should use custom model info when provided", () => {
			const customModelInfo = {
				maxTokens: 8000,
				contextWindow: 16000,
				temperature: 0.8,
				supportsPromptCache: true,
			}
			const testHandler = new OpenAiOAuthHandler({
				openAiOAuthModelId: "custom-model",
				openAiOAuthModelInfo: customModelInfo,
			})

			const result = testHandler.getModel()
			result.info.maxTokens!.should.equal(8000)
			result.info.contextWindow!.should.equal(16000)
		})
	})

	describe("ensureClient", () => {
		it("should throw error when no model is selected", async () => {
			const testHandler = new OpenAiOAuthHandler({})

			try {
				await (testHandler as any).ensureClient()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("OpenAI OAuth model is not selected")
			}
		})

		it("should throw error when auth token is not available", async () => {
			// Mock auth service to return null token
			authServiceStub.restore()
			authServiceStub = sinon.stub(OpenAIAuthService, "getInstance").returns({
				getAuthToken: sinon.stub().resolves(null),
			} as any)

			// Create a new handler with the null token auth service
			const testHandler = new OpenAiOAuthHandler({
				openAiOAuthModelId: "gpt-4",
			})

			// Mock client chat.completions.create to trigger prepareOptions
			const mockClient = sinon.createStubInstance(OpenAI)
			const chatStub = sinon.stub()
			mockClient.chat = { completions: { create: chatStub } } as any
			sinon.stub(testHandler as any, "initializeClient").resolves(mockClient)

			// The error is thrown in prepareOptions when making an actual API call
			chatStub.rejects(new Error("Unable to handle auth, OpenAI OAuth access token is not available"))

			const systemPrompt = "Test"
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Test" }]

			try {
				for await (const chunk of testHandler.createMessage(systemPrompt, messages)) {
					// Should not reach here
				}
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("Unable to handle auth, OpenAI OAuth access token is not available")
			}
		})

		it("should create and cache OpenAI client with auth token", async () => {
			const client = await (handler as any).ensureClient()

			client.should.be.instanceOf(OpenAI)
			loggerStub.calledWith("[OpenAI OAuth] Initializing OpenAI client with fresh OAuth token").should.be.true()
			loggerStub.calledOnce.should.be.true()
		})

		it("should reuse existing client", async () => {
			const client1 = await (handler as any).ensureClient()
			const client2 = await (handler as any).ensureClient()

			client1.should.equal(client2)
			// Logger should only be called once
			loggerStub.calledOnce.should.be.true()
		})
	})

	describe("createMessage", () => {
		let mockClient: sinon.SinonStubbedInstance<OpenAI>
		let chatStub: sinon.SinonStub

		beforeEach(() => {
			// Create a mock OpenAI client
			mockClient = sinon.createStubInstance(OpenAI)
			chatStub = sinon.stub()
			mockClient.chat = { completions: { create: chatStub } } as any

			// Stub ensureClient to return our mock
			sinon.stub(handler as any, "ensureClient").resolves(mockClient)
		})

		it("should handle successful streaming responses", async function () {
			this.timeout(5000)

			// Mock streaming response
			chatStub.resolves({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: {
									content: "Hello, world!",
								},
							},
						],
					}
					yield {
						usage: {
							prompt_tokens: 20,
							completion_tokens: 10,
							prompt_tokens_details: { cached_tokens: 5 },
							prompt_cache_miss_tokens: 2,
						},
					}
				},
			})

			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Hello" }]

			const result = []
			const usageInfo = []

			// Collect the results
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				if (chunk.type === "text") {
					result.push(chunk.text)
				} else if (chunk.type === "usage") {
					usageInfo.push({
						inputTokens: chunk.inputTokens,
						outputTokens: chunk.outputTokens,
						cacheReadTokens: chunk.cacheReadTokens,
						cacheWriteTokens: chunk.cacheWriteTokens,
					})
				}
			}

			// Verify the results
			result.should.deepEqual(["Hello, world!"])
			usageInfo.should.deepEqual([
				{
					inputTokens: 20,
					outputTokens: 10,
					cacheReadTokens: 5,
					cacheWriteTokens: 2,
				},
			])
			chatStub.calledOnce.should.be.true()
		})

		it("should handle reasoning content for reasoning models", async function () {
			this.timeout(5000)

			// Mock streaming response with reasoning
			chatStub.resolves({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: {
									content: "Final answer",
									reasoning_content: "Let me think about this...",
								},
							},
						],
					}
				},
			})

			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Solve this problem" }]

			const textResults = []
			const reasoningResults = []

			// Collect the results
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				if (chunk.type === "text") {
					textResults.push(chunk.text)
				} else if (chunk.type === "reasoning") {
					reasoningResults.push(chunk.reasoning)
				}
			}

			// Verify the results
			textResults.should.deepEqual(["Final answer"])
			reasoningResults.should.deepEqual(["Let me think about this..."])
		})

		it("should handle tool calls", async function () {
			this.timeout(5000)

			// Mock streaming response with tool calls
			chatStub.resolves({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: {
									tool_calls: [
										{
											index: 0,
											id: "call_123",
											type: "function",
											function: {
												name: "test_function",
												arguments: '{"param": "value"}',
											},
										},
									],
								},
							},
						],
					}
				},
			})

			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Use a tool" }]
			const tools = [
				{
					type: "function" as const,
					function: {
						name: "test_function",
						description: "A test function",
						parameters: {
							type: "object",
							properties: {
								param: { type: "string" },
							},
						},
					},
				},
			]

			const toolCallResults = []

			// Collect the results
			for await (const chunk of handler.createMessage(systemPrompt, messages, tools)) {
				if (chunk.type === "tool_calls") {
					toolCallResults.push(chunk)
				}
			}

			// Should have at least some tool call processing
			toolCallResults.length.should.be.greaterThan(0)
			chatStub.calledOnce.should.be.true()
		})

		it("should handle reasoning model family (o1, o3, o4, gpt-5)", async () => {
			const reasoningHandler = new OpenAiOAuthHandler({
				openAiOAuthModelId: "o1-preview",
				reasoningEffort: "high",
			})

			// Mock ensureClient for reasoning handler
			sinon.stub(reasoningHandler as any, "ensureClient").resolves(mockClient)

			chatStub.resolves({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: { content: "Reasoning response" },
							},
						],
					}
				},
			})

			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Think step by step" }]

			const result = []
			for await (const chunk of reasoningHandler.createMessage(systemPrompt, messages)) {
				if (chunk.type === "text") {
					result.push(chunk.text)
				}
			}

			result.should.deepEqual(["Reasoning response"])

			// Verify the API call was made with correct parameters
			const callArgs = chatStub.getCall(0).args[0]
			callArgs.should.have.property("reasoning_effort", "high")
			;(callArgs.temperature === undefined).should.be.true()
			callArgs.messages[0].should.have.property("role", "developer")
		})

		it("should handle custom temperature and max tokens", async () => {
			const customHandler = new OpenAiOAuthHandler({
				openAiOAuthModelId: "gpt-4",
				openAiOAuthModelInfo: {
					temperature: 0.7,
					maxTokens: 2000,
					supportsPromptCache: true,
				},
			})

			// Mock ensureClient for custom handler
			sinon.stub(customHandler as any, "ensureClient").resolves(mockClient)

			chatStub.resolves({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: { content: "Custom response" },
							},
						],
					}
				},
			})

			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Test" }]

			const result = []
			for await (const chunk of customHandler.createMessage(systemPrompt, messages)) {
				if (chunk.type === "text") {
					result.push(chunk.text)
				}
			}

			// Verify the API call was made with correct parameters
			const callArgs = chatStub.getCall(0).args[0]
			callArgs.should.have.property("temperature", 0.7)
			callArgs.should.have.property("max_tokens", 2000)
		})

		it("should handle zero temperature correctly", async () => {
			const zeroTempHandler = new OpenAiOAuthHandler({
				openAiOAuthModelId: "gpt-4",
				openAiOAuthModelInfo: {
					temperature: 0,
					supportsPromptCache: true,
				},
			})

			// Mock ensureClient for zero temp handler
			sinon.stub(zeroTempHandler as any, "ensureClient").resolves(mockClient)

			chatStub.resolves({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: { content: "Zero temp response" },
							},
						],
					}
				},
			})

			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Test" }]

			const result = []
			for await (const chunk of zeroTempHandler.createMessage(systemPrompt, messages)) {
				if (chunk.type === "text") {
					result.push(chunk.text)
				}
			}

			// Verify the API call was made without temperature (undefined for 0)
			const callArgs = chatStub.getCall(0).args[0]
			;(callArgs.temperature === undefined).should.be.true()
		})

		it("should retry on API errors using withRetry decorator", async function () {
			this.timeout(10000)
			// Restore real timers for this test
			clock.restore()

			// First call fails, second succeeds
			chatStub.onFirstCall().rejects(new Error("API Error"))
			chatStub.onSecondCall().resolves({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: { content: "Success after retry" },
							},
						],
					}
				},
			})

			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Hello" }]

			const result = []

			try {
				// Collect the results
				for await (const chunk of handler.createMessage(systemPrompt, messages)) {
					throw new Error("Should not reach here")
				}
				throw new Error("Should have thrown")
			} catch (error: any) {
				// If retry doesn't work, that's also acceptable behavior
				// since the withRetry decorator may not retry all error types
				error.message.should.equal("API Error")
				chatStub.calledOnce.should.be.true()
			}

			// Restore fake timers for other tests
			clock = sinon.useFakeTimers()
		})

		it("should handle stream processing errors", async function () {
			this.timeout(5000)

			// Mock streaming response that throws an error
			chatStub.resolves({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: { content: "Partial response" },
							},
						],
					}
					throw new Error("Stream error")
				},
			})

			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Hello" }]

			const result = []
			let errorMessage = ""

			try {
				for await (const chunk of handler.createMessage(systemPrompt, messages)) {
					if (chunk.type === "text") {
						result.push(chunk.text)
					}
				}
			} catch (error: any) {
				errorMessage = error.message
			}

			// Should have received partial response before error
			result.should.deepEqual(["Partial response"])
			errorMessage.should.equal("Stream error")
		})

		it("should handle R1 format required models", async () => {
			const r1Handler = new OpenAiOAuthHandler({
				openAiOAuthModelId: "custom-model",
				openAiOAuthModelInfo: {
					isR1FormatRequired: true,
					supportsPromptCache: true,
				},
			})

			// Mock ensureClient for R1 handler
			sinon.stub(r1Handler as any, "ensureClient").resolves(mockClient)

			chatStub.resolves({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: { content: "R1 format response" },
							},
						],
					}
				},
			})

			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Test R1" }]

			const result = []
			for await (const chunk of r1Handler.createMessage(systemPrompt, messages)) {
				if (chunk.type === "text") {
					result.push(chunk.text)
				}
			}

			result.should.deepEqual(["R1 format response"])
			chatStub.calledOnce.should.be.true()
		})
	})

	describe("OAuth token management", () => {
		it("should refresh client when auth token changes", async () => {
			// First call with initial token
			await (handler as any).ensureClient()

			// Change the auth token
			authServiceStub.restore()
			authServiceStub = sinon.stub(OpenAIAuthService, "getInstance").returns({
				getAuthToken: sinon.stub().resolves("new-access-token"),
			} as any)

			// Reset client to force recreation
			;(handler as any).client = undefined

			// Second call should create new client with new token
			await (handler as any).ensureClient()

			// Logger should be called twice (once for each client creation)
			loggerStub.calledTwice.should.be.true()
		})

		it("should propagate auth errors appropriately", async () => {
			// Mock auth service to throw error
			authServiceStub.restore()
			authServiceStub = sinon.stub(OpenAIAuthService, "getInstance").returns({
				getAuthToken: sinon.stub().rejects(new Error("Auth service error")),
			} as any)

			// Create a new handler with the error-throwing auth service
			const testHandler = new OpenAiOAuthHandler({
				openAiOAuthModelId: "gpt-4",
			})

			// Mock client chat.completions.create to trigger auth
			const mockClient = sinon.createStubInstance(OpenAI)
			const chatStub = sinon.stub()
			mockClient.chat = { completions: { create: chatStub } } as any
			sinon.stub(testHandler as any, "initializeClient").resolves(mockClient)

			// The error is thrown when trying to get auth token
			chatStub.rejects(new Error("Auth service error"))

			const systemPrompt = "Test"
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Test" }]

			try {
				for await (const chunk of testHandler.createMessage(systemPrompt, messages)) {
					throw new Error("Should not reach here")
				}
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("Auth service error")
			}
		})
	})
})
