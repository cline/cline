import { AwsBedrockHandler } from "../bedrock"
import { ApiHandlerOptions } from "../../../shared/api"

// Mock the AWS SDK
jest.mock("@aws-sdk/client-bedrock-runtime", () => {
	const mockSend = jest.fn().mockImplementation(() => {
		return Promise.resolve({
			output: new TextEncoder().encode(JSON.stringify({ content: "Test response" })),
		})
	})

	return {
		BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
			send: mockSend,
			config: {
				region: "us-east-1",
			},
		})),
		ConverseCommand: jest.fn(),
		ConverseStreamCommand: jest.fn(),
	}
})

describe("AwsBedrockHandler with custom ARN", () => {
	const mockOptions: ApiHandlerOptions = {
		apiModelId: "custom-arn",
		awsCustomArn: "arn:aws:bedrock:us-east-1:123456789012:foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
		awsRegion: "us-east-1",
	}

	it("should use the custom ARN as the model ID", async () => {
		const handler = new AwsBedrockHandler(mockOptions)
		const model = handler.getModel()

		expect(model.id).toBe(mockOptions.awsCustomArn)
		expect(model.info).toHaveProperty("maxTokens")
		expect(model.info).toHaveProperty("contextWindow")
		expect(model.info).toHaveProperty("supportsPromptCache")
	})

	it("should extract region from ARN and use it for client configuration", () => {
		// Test with matching region
		const handler1 = new AwsBedrockHandler(mockOptions)
		expect((handler1 as any).client.config.region).toBe("us-east-1")

		// Test with mismatched region
		const mismatchOptions = {
			...mockOptions,
			awsRegion: "us-west-2",
		}
		const handler2 = new AwsBedrockHandler(mismatchOptions)
		// Should use the ARN region, not the provided region
		expect((handler2 as any).client.config.region).toBe("us-east-1")
	})

	it("should validate ARN format", async () => {
		// Invalid ARN format
		const invalidOptions = {
			...mockOptions,
			awsCustomArn: "invalid-arn-format",
		}

		const handler = new AwsBedrockHandler(invalidOptions)

		// completePrompt should throw an error for invalid ARN
		await expect(handler.completePrompt("test")).rejects.toThrow("Invalid ARN format")
	})

	it("should complete a prompt successfully with valid ARN", async () => {
		const handler = new AwsBedrockHandler(mockOptions)
		const response = await handler.completePrompt("test prompt")

		expect(response).toBe("Test response")
	})
})
