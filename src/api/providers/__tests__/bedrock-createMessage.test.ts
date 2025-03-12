// Mock AWS SDK credential providers
jest.mock("@aws-sdk/credential-providers", () => ({
	fromIni: jest.fn().mockReturnValue({
		accessKeyId: "profile-access-key",
		secretAccessKey: "profile-secret-key",
	}),
}))

import { AwsBedrockHandler, StreamEvent } from "../bedrock"
import { ApiHandlerOptions } from "../../../shared/api"
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime"
import { logger } from "../../../utils/logging"

describe("AwsBedrockHandler createMessage", () => {
	let mockSend: jest.SpyInstance

	beforeEach(() => {
		// Mock the BedrockRuntimeClient.prototype.send method
		mockSend = jest.spyOn(BedrockRuntimeClient.prototype, "send").mockImplementation(async () => {
			return {
				stream: createMockStream([]),
			}
		})
	})

	afterEach(() => {
		mockSend.mockRestore()
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

	it("should log debug information during createMessage with custom ARN", async () => {
		// Create a handler with a custom ARN
		const mockOptions: ApiHandlerOptions = {
			apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			awsAccessKey: "test-access-key",
			awsSecretKey: "test-secret-key",
			awsRegion: "us-east-1",
			awsCustomArn: "arn:aws:bedrock:us-east-1:123456789:foundation-model/custom-model",
		}

		const handler = new AwsBedrockHandler(mockOptions)

		// Mock the stream to include various events that trigger debug logs
		mockSend.mockImplementationOnce(async () => {
			return {
				stream: createMockStream([
					// Event with invokedModelId
					{
						trace: {
							promptRouter: {
								invokedModelId:
									"arn:aws:bedrock:us-east-1:123456789:foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
							},
						},
					},
					// Content events
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

		// Collect all yielded events
		const events = []
		for await (const event of messageGenerator) {
			events.push(event)
		}

		// Verify that events were yielded
		expect(events.length).toBeGreaterThan(0)

		// Verify that debug logs were called
		expect(logger.debug).toHaveBeenCalledWith(
			"Using custom ARN for Bedrock request",
			expect.objectContaining({
				ctx: "bedrock",
				customArn: mockOptions.awsCustomArn,
			}),
		)

		expect(logger.debug).toHaveBeenCalledWith(
			"Bedrock invokedModelId detected",
			expect.objectContaining({
				ctx: "bedrock",
				invokedModelId:
					"arn:aws:bedrock:us-east-1:123456789:foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
			}),
		)
	})

	it("should log debug information during createMessage with cross-region inference", async () => {
		// Create a handler with cross-region inference
		const mockOptions: ApiHandlerOptions = {
			apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			awsAccessKey: "test-access-key",
			awsSecretKey: "test-secret-key",
			awsRegion: "us-east-1",
			awsUseCrossRegionInference: true,
		}

		const handler = new AwsBedrockHandler(mockOptions)

		// Create a message generator
		const messageGenerator = handler.createMessage("system prompt", [{ role: "user", content: "user message" }])

		// Collect all yielded events
		const events = []
		for await (const event of messageGenerator) {
			events.push(event)
		}

		// Verify that events were yielded
		expect(events.length).toBeGreaterThan(0)
	})
})
