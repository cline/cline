// npx jest src/api/providers/__tests__/bedrock-invokedModelId.test.ts

import { ApiHandlerOptions } from "../../../shared/api"

import { AwsBedrockHandler, StreamEvent } from "../bedrock"

// Mock AWS SDK credential providers and Bedrock client
jest.mock("@aws-sdk/credential-providers", () => ({
	fromIni: jest.fn().mockReturnValue({
		accessKeyId: "profile-access-key",
		secretAccessKey: "profile-secret-key",
	}),
}))

// Mock Smithy client
jest.mock("@smithy/smithy-client", () => ({
	throwDefaultError: jest.fn(),
}))

// Mock AWS SDK modules
jest.mock("@aws-sdk/client-bedrock-runtime", () => {
	const mockSend = jest.fn().mockImplementation(async () => {
		return {
			$metadata: {
				httpStatusCode: 200,
				requestId: "mock-request-id",
			},
			stream: {
				[Symbol.asyncIterator]: async function* () {
					yield {
						metadata: {
							usage: {
								inputTokens: 100,
								outputTokens: 200,
							},
						},
					}
				},
			},
		}
	})

	return {
		BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
			send: mockSend,
			config: { region: "us-east-1" },
			middlewareStack: {
				clone: () => ({ resolve: () => {} }),
				use: () => {},
			},
		})),
		ConverseStreamCommand: jest.fn((params) => ({
			...params,
			input: params,
			middlewareStack: {
				clone: () => ({ resolve: () => {} }),
				use: () => {},
			},
		})),
		ConverseCommand: jest.fn((params) => ({
			...params,
			input: params,
			middlewareStack: {
				clone: () => ({ resolve: () => {} }),
				use: () => {},
			},
		})),
	}
})

describe("AwsBedrockHandler with invokedModelId", () => {
	let mockSend: jest.Mock

	beforeEach(() => {
		jest.clearAllMocks()
		// Get the mock send function from our mocked module
		const { BedrockRuntimeClient } = require("@aws-sdk/client-bedrock-runtime")
		mockSend = BedrockRuntimeClient().send
	})

	// Helper function to create a mock async iterable stream
	function createMockStream(events: StreamEvent[]) {
		return {
			[Symbol.asyncIterator]: async function* () {
				for (const event of events) {
					yield event
				}
				// Always yield a metadata event at the end
				yield {
					metadata: {
						usage: {
							inputTokens: 100,
							outputTokens: 200,
						},
					},
				}
			},
		}
	}

	it("should update costModelConfig when invokedModelId is present in the stream", async () => {
		// Create a handler with a custom ARN
		const mockOptions: ApiHandlerOptions = {
			awsAccessKey: "test-access-key",
			awsSecretKey: "test-secret-key",
			awsRegion: "us-east-1",
			awsCustomArn: "arn:aws:bedrock:us-west-2:123456789:default-prompt-router/anthropic.claude:1",
		}

		const handler = new AwsBedrockHandler(mockOptions)

		// Verify that getModel returns the updated model info
		const initialModel = handler.getModel()
		//the default prompt router model has an input price of 3. After the stream is handled it should be updated to 8
		expect(initialModel.info.inputPrice).toBe(3)

		// Create a spy on the getModel
		const getModelByIdSpy = jest.spyOn(handler, "getModelById")

		// Mock the stream to include an event with invokedModelId and usage metadata
		mockSend.mockImplementationOnce(async () => {
			return {
				stream: createMockStream([
					// First event with invokedModelId and usage metadata
					{
						trace: {
							promptRouter: {
								invokedModelId:
									"arn:aws:bedrock:us-west-2:699475926481:inference-profile/us.anthropic.claude-2-1-v1:0",
								usage: {
									inputTokens: 150,
									outputTokens: 250,
									cacheReadTokens: 0,
									cacheWriteTokens: 0,
								},
							},
						},
					},
					{
						contentBlockStart: {
							start: {
								text: "Hello",
							},
							contentBlockIndex: 0,
						},
					},
					{
						contentBlockDelta: {
							delta: {
								text: ", world!",
							},
							contentBlockIndex: 0,
						},
					},
				]),
			}
		})

		// Create a message generator
		const messageGenerator = handler.createMessage("system prompt", [{ role: "user", content: "user message" }])

		// Collect all yielded events to verify usage events
		const events = []
		for await (const event of messageGenerator) {
			events.push(event)
		}

		// Verify that getModelById was called with the id, not the full arn
		expect(getModelByIdSpy).toHaveBeenCalledWith("anthropic.claude-2-1-v1:0", "inference-profile")

		// Verify that getModel returns the updated model info
		const costModel = handler.getModel()
		//expect(costModel.id).toBe("anthropic.claude-3-5-sonnet-20240620-v1:0")
		expect(costModel.info.inputPrice).toBe(8)

		// Verify that a usage event was emitted after updating the costModelConfig
		const usageEvents = events.filter((event) => event.type === "usage")
		expect(usageEvents.length).toBeGreaterThanOrEqual(1)

		// The last usage event should have the token counts from the metadata
		const lastUsageEvent = usageEvents[usageEvents.length - 1]
		// Expect the usage event to include all token information
		expect(lastUsageEvent).toMatchObject({
			type: "usage",
			inputTokens: 100,
			outputTokens: 200,
			// Cache tokens may be present with default values
			cacheReadTokens: expect.any(Number),
			cacheWriteTokens: expect.any(Number),
		})
	})

	it("should not update costModelConfig when invokedModelId is not present", async () => {
		// Create a handler with default settings
		const mockOptions: ApiHandlerOptions = {
			apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			awsAccessKey: "test-access-key",
			awsSecretKey: "test-secret-key",
			awsRegion: "us-east-1",
		}

		const handler = new AwsBedrockHandler(mockOptions)

		// Store the initial model configuration
		const initialModelConfig = handler.getModel()
		expect(initialModelConfig.id).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")

		// Mock the stream without an invokedModelId event
		mockSend.mockImplementationOnce(async () => {
			return {
				stream: createMockStream([
					// Some content events but no invokedModelId
					{
						contentBlockStart: {
							start: {
								text: "Hello",
							},
							contentBlockIndex: 0,
						},
					},
					{
						contentBlockDelta: {
							delta: {
								text: ", world!",
							},
							contentBlockIndex: 0,
						},
					},
				]),
			}
		})

		// Create a message generator
		const messageGenerator = handler.createMessage("system prompt", [{ role: "user", content: "user message" }])

		// Consume the generator
		for await (const _ of messageGenerator) {
			// Just consume the messages
		}

		// Verify that getModel returns the original model info (unchanged)
		const costModel = handler.getModel()
		expect(costModel.id).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
		expect(costModel).toEqual(initialModelConfig)
	})

	it("should handle invalid invokedModelId format gracefully", async () => {
		// Create a handler with default settings
		const mockOptions: ApiHandlerOptions = {
			apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			awsAccessKey: "test-access-key",
			awsSecretKey: "test-secret-key",
			awsRegion: "us-east-1",
		}

		const handler = new AwsBedrockHandler(mockOptions)

		// Mock the stream with an invalid invokedModelId
		mockSend.mockImplementationOnce(async () => {
			return {
				stream: createMockStream([
					// Event with invalid invokedModelId format
					{
						trace: {
							promptRouter: {
								invokedModelId: "invalid-format-not-an-arn",
							},
						},
					},
					// Some content events
					{
						contentBlockStart: {
							start: {
								text: "Hello",
							},
							contentBlockIndex: 0,
						},
					},
				]),
			}
		})

		// Create a message generator
		const messageGenerator = handler.createMessage("system prompt", [{ role: "user", content: "user message" }])

		// Consume the generator
		for await (const _ of messageGenerator) {
			// Just consume the messages
		}

		// Verify that getModel returns the original model info
		const costModel = handler.getModel()
		expect(costModel.id).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
	})

	it("should handle errors during invokedModelId processing", async () => {
		// Create a handler with default settings
		const mockOptions: ApiHandlerOptions = {
			apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			awsAccessKey: "test-access-key",
			awsSecretKey: "test-secret-key",
			awsRegion: "us-east-1",
		}

		const handler = new AwsBedrockHandler(mockOptions)

		// Mock the stream with a valid invokedModelId
		mockSend.mockImplementationOnce(async () => {
			return {
				stream: createMockStream([
					// Event with valid invokedModelId
					{
						trace: {
							promptRouter: {
								invokedModelId:
									"arn:aws:bedrock:us-east-1:123456789:foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
							},
						},
					},
				]),
			}
		})

		// Mock getModel to throw an error when called with the model name
		jest.spyOn(handler, "getModel").mockImplementation((modelName?: string) => {
			if (modelName === "anthropic.claude-3-sonnet-20240229-v1:0") {
				throw new Error("Test error during model lookup")
			}

			// Default return value for initial call
			return {
				id: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				info: {
					maxTokens: 4096,
					contextWindow: 128_000,
					supportsPromptCache: false,
					supportsImages: true,
				},
			}
		})

		// Create a message generator
		const messageGenerator = handler.createMessage("system prompt", [{ role: "user", content: "user message" }])

		// Consume the generator
		for await (const _ of messageGenerator) {
			// Just consume the messages
		}

		// Verify that getModel returns the original model info
		const costModel = handler.getModel()
		expect(costModel.id).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
	})
})
