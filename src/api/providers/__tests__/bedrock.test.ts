// Mock AWS SDK credential providers
jest.mock("@aws-sdk/credential-providers", () => ({
	fromIni: jest.fn().mockReturnValue({
		accessKeyId: "profile-access-key",
		secretAccessKey: "profile-secret-key",
	}),
}))

import { AwsBedrockHandler } from "../bedrock"
import { MessageContent } from "../../../shared/api"
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime"
import { Anthropic } from "@anthropic-ai/sdk"
import { fromIni } from "@aws-sdk/credential-providers"

describe("AwsBedrockHandler", () => {
	let handler: AwsBedrockHandler

	beforeEach(() => {
		handler = new AwsBedrockHandler({
			apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			awsAccessKey: "test-access-key",
			awsSecretKey: "test-secret-key",
			awsRegion: "us-east-1",
		})
	})

	describe("constructor", () => {
		it("should initialize with provided config", () => {
			expect(handler["options"].awsAccessKey).toBe("test-access-key")
			expect(handler["options"].awsSecretKey).toBe("test-secret-key")
			expect(handler["options"].awsRegion).toBe("us-east-1")
			expect(handler["options"].apiModelId).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
		})

		it("should initialize with missing AWS credentials", () => {
			const handlerWithoutCreds = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsRegion: "us-east-1",
			})
			expect(handlerWithoutCreds).toBeInstanceOf(AwsBedrockHandler)
		})

		it("should initialize with AWS profile credentials", () => {
			const handlerWithProfile = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsRegion: "us-east-1",
				awsUseProfile: true,
				awsProfile: "test-profile",
			})
			expect(handlerWithProfile).toBeInstanceOf(AwsBedrockHandler)
			expect(handlerWithProfile["options"].awsUseProfile).toBe(true)
			expect(handlerWithProfile["options"].awsProfile).toBe("test-profile")
		})

		it("should initialize with AWS profile enabled but no profile set", () => {
			const handlerWithoutProfile = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsRegion: "us-east-1",
				awsUseProfile: true,
			})
			expect(handlerWithoutProfile).toBeInstanceOf(AwsBedrockHandler)
			expect(handlerWithoutProfile["options"].awsUseProfile).toBe(true)
			expect(handlerWithoutProfile["options"].awsProfile).toBeUndefined()
		})
	})

	describe("AWS SDK client configuration", () => {
		it("should configure client with profile credentials when profile mode is enabled", async () => {
			// Import the fromIni function to mock it
			jest.mock("@aws-sdk/credential-providers", () => ({
				fromIni: jest.fn().mockReturnValue({
					accessKeyId: "profile-access-key",
					secretAccessKey: "profile-secret-key",
				}),
			}))

			const handlerWithProfile = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsRegion: "us-east-1",
				awsUseProfile: true,
				awsProfile: "test-profile",
			})

			// Mock a simple API call to verify credentials are used
			const mockResponse = {
				output: new TextEncoder().encode(JSON.stringify({ content: "test" })),
			}
			const mockSend = jest.fn().mockResolvedValue(mockResponse)
			handlerWithProfile["client"] = {
				send: mockSend,
			} as unknown as BedrockRuntimeClient

			await handlerWithProfile.completePrompt("test")

			// Verify the client was configured with profile credentials
			expect(mockSend).toHaveBeenCalled()
			expect(fromIni).toHaveBeenCalledWith({
				profile: "test-profile",
			})
		})
	})

	describe("createMessage", () => {
		const mockMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Hello",
			},
			{
				role: "assistant",
				content: "Hi there!",
			},
		]

		const systemPrompt = "You are a helpful assistant"

		it("should handle text messages correctly", async () => {
			const mockResponse = {
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "Hello! How can I help you?" }],
					},
				],
				usage: {
					input_tokens: 10,
					output_tokens: 5,
				},
			}

			// Mock AWS SDK invoke
			const mockStream = {
				[Symbol.asyncIterator]: async function* () {
					yield {
						metadata: {
							usage: {
								inputTokens: 10,
								outputTokens: 5,
							},
						},
					}
				},
			}

			const mockInvoke = jest.fn().mockResolvedValue({
				stream: mockStream,
			})

			handler["client"] = {
				send: mockInvoke,
			} as unknown as BedrockRuntimeClient

			const stream = handler.createMessage(systemPrompt, mockMessages)
			const chunks = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBeGreaterThan(0)
			expect(chunks[0]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 5,
			})

			expect(mockInvoke).toHaveBeenCalledWith(
				expect.objectContaining({
					input: expect.objectContaining({
						modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					}),
				}),
			)
		})

		it("should handle API errors", async () => {
			// Mock AWS SDK invoke with error
			const mockInvoke = jest.fn().mockRejectedValue(new Error("AWS Bedrock error"))

			handler["client"] = {
				send: mockInvoke,
			} as unknown as BedrockRuntimeClient

			const stream = handler.createMessage(systemPrompt, mockMessages)

			await expect(async () => {
				for await (const chunk of stream) {
					// Should throw before yielding any chunks
				}
			}).rejects.toThrow("AWS Bedrock error")
		})
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully", async () => {
			const mockResponse = {
				output: new TextEncoder().encode(
					JSON.stringify({
						content: "Test response",
					}),
				),
			}

			const mockSend = jest.fn().mockResolvedValue(mockResponse)
			handler["client"] = {
				send: mockSend,
			} as unknown as BedrockRuntimeClient

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(mockSend).toHaveBeenCalledWith(
				expect.objectContaining({
					input: expect.objectContaining({
						modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
						messages: expect.arrayContaining([
							expect.objectContaining({
								role: "user",
								content: [{ text: "Test prompt" }],
							}),
						]),
						inferenceConfig: expect.objectContaining({
							maxTokens: 5000,
							temperature: 0.3,
							topP: 0.1,
						}),
					}),
				}),
			)
		})

		it("should handle API errors", async () => {
			const mockError = new Error("AWS Bedrock error")
			const mockSend = jest.fn().mockRejectedValue(mockError)
			handler["client"] = {
				send: mockSend,
			} as unknown as BedrockRuntimeClient

			await expect(handler.completePrompt("Test prompt")).rejects.toThrow(
				"Bedrock completion error: AWS Bedrock error",
			)
		})

		it("should handle invalid response format", async () => {
			const mockResponse = {
				output: new TextEncoder().encode("invalid json"),
			}

			const mockSend = jest.fn().mockResolvedValue(mockResponse)
			handler["client"] = {
				send: mockSend,
			} as unknown as BedrockRuntimeClient

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should handle empty response", async () => {
			const mockResponse = {
				output: new TextEncoder().encode(JSON.stringify({})),
			}

			const mockSend = jest.fn().mockResolvedValue(mockResponse)
			handler["client"] = {
				send: mockSend,
			} as unknown as BedrockRuntimeClient

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should handle cross-region inference", async () => {
			handler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
				awsUseCrossRegionInference: true,
			})

			const mockResponse = {
				output: new TextEncoder().encode(
					JSON.stringify({
						content: "Test response",
					}),
				),
			}

			const mockSend = jest.fn().mockResolvedValue(mockResponse)
			handler["client"] = {
				send: mockSend,
			} as unknown as BedrockRuntimeClient

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(mockSend).toHaveBeenCalledWith(
				expect.objectContaining({
					input: expect.objectContaining({
						modelId: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
					}),
				}),
			)
		})
	})

	describe("getModel", () => {
		it("should return correct model info in test environment", () => {
			const modelInfo = handler.getModel()
			expect(modelInfo.id).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
			expect(modelInfo.info).toBeDefined()
			expect(modelInfo.info.maxTokens).toBe(5000) // Test environment value
			expect(modelInfo.info.contextWindow).toBe(128_000) // Test environment value
		})

		it("should return test model info for invalid model in test environment", () => {
			const invalidHandler = new AwsBedrockHandler({
				apiModelId: "invalid-model",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
			})
			const modelInfo = invalidHandler.getModel()
			expect(modelInfo.id).toBe("invalid-model") // In test env, returns whatever is passed
			expect(modelInfo.info.maxTokens).toBe(5000)
			expect(modelInfo.info.contextWindow).toBe(128_000)
		})
	})
})
