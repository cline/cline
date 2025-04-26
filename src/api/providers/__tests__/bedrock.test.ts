// Mock AWS SDK credential providers
jest.mock("@aws-sdk/credential-providers", () => {
	const mockFromIni = jest.fn().mockReturnValue({
		accessKeyId: "profile-access-key",
		secretAccessKey: "profile-secret-key",
	})
	return { fromIni: mockFromIni }
})

// Mock BedrockRuntimeClient and ConverseStreamCommand
const mockConverseStreamCommand = jest.fn()
const mockSend = jest.fn().mockResolvedValue({
	stream: [],
})

jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
	BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
		send: mockSend,
	})),
	ConverseStreamCommand: mockConverseStreamCommand,
	ConverseCommand: jest.fn(),
}))

import { AwsBedrockHandler } from "../bedrock"

import { Anthropic } from "@anthropic-ai/sdk"

describe("AwsBedrockHandler", () => {
	let handler: AwsBedrockHandler

	beforeEach(() => {
		// Clear all mocks before each test
		jest.clearAllMocks()

		handler = new AwsBedrockHandler({
			apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
			awsAccessKey: "test-access-key",
			awsSecretKey: "test-secret-key",
			awsRegion: "us-east-1",
		})
	})

	describe("getModel", () => {
		it("should return the correct model info for a standard model", () => {
			const modelInfo = handler.getModel()
			expect(modelInfo.id).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
			expect(modelInfo.info).toBeDefined()
			expect(modelInfo.info.maxTokens).toBeDefined()
			expect(modelInfo.info.contextWindow).toBeDefined()
		})

		it("should use custom ARN when provided", () => {
			// This test is incompatible with the refactored implementation
			// The implementation now extracts the model ID from the ARN instead of using the ARN directly
			// We'll update the test to match the new behavior
			const customArnHandler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
				awsCustomArn: "arn:aws:bedrock:us-east-1::inference-profile/custom-model",
			})

			const modelInfo = customArnHandler.getModel()
			// Now we expect the model ID to be extracted from the ARN
			expect(modelInfo.id).toBe("arn:aws:bedrock:us-east-1::inference-profile/custom-model")
			expect(modelInfo.info).toBeDefined()
		})

		it("should handle inference-profile ARN with apne3 region prefix", () => {
			const originalParseArn = AwsBedrockHandler.prototype["parseArn"]
			const parseArnMock = jest.fn().mockImplementation(function (this: any, arn: string, region?: string) {
				return originalParseArn.call(this, arn, region)
			})
			AwsBedrockHandler.prototype["parseArn"] = parseArnMock

			try {
				const customArnHandler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test-access-key",
					awsSecretKey: "test-secret-key",
					awsRegion: "ap-northeast-3",
					awsCustomArn:
						"arn:aws:bedrock:ap-northeast-3:123456789012:inference-profile/apne3.anthropic.claude-3-5-sonnet-20241022-v2:0",
				})

				const modelInfo = customArnHandler.getModel()

				expect(modelInfo.id).toBe(
					"arn:aws:bedrock:ap-northeast-3:123456789012:inference-profile/apne3.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)
				expect(modelInfo.info).toBeDefined()

				expect(parseArnMock).toHaveBeenCalledWith(
					"arn:aws:bedrock:ap-northeast-3:123456789012:inference-profile/apne3.anthropic.claude-3-5-sonnet-20241022-v2:0",
					"ap-northeast-3",
				)

				expect((customArnHandler as any).arnInfo.modelId).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
				expect((customArnHandler as any).arnInfo.crossRegionInference).toBe(false)
			} finally {
				AwsBedrockHandler.prototype["parseArn"] = originalParseArn
			}
		})

		it("should use default prompt router model when prompt router arn is entered but no model can be identified from the ARN", () => {
			const customArnHandler = new AwsBedrockHandler({
				awsCustomArn:
					"arn:aws:bedrock:ap-northeast-3:123456789012:default-prompt-router/my_router_arn_no_model",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
			})
			const modelInfo = customArnHandler.getModel()
			expect(modelInfo.id).toBe(
				"arn:aws:bedrock:ap-northeast-3:123456789012:default-prompt-router/my_router_arn_no_model",
			)
			expect(modelInfo.info).toBeDefined()
			expect(modelInfo.info.maxTokens).toBe(4096)
		})
	})

	describe("image handling", () => {
		const mockImageData = Buffer.from("test-image-data").toString("base64")

		beforeEach(() => {
			// Reset the mocks before each test
			mockSend.mockReset()
			mockConverseStreamCommand.mockReset()

			mockSend.mockResolvedValue({
				stream: [],
			})
		})

		it("should properly convert image content to Bedrock format", async () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "image",
							source: {
								type: "base64",
								data: mockImageData,
								media_type: "image/jpeg",
							},
						},
						{
							type: "text",
							text: "What's in this image?",
						},
					],
				},
			]

			const generator = handler.createMessage("", messages)
			await generator.next() // Start the generator

			// Verify the command was created with the right payload
			expect(mockConverseStreamCommand).toHaveBeenCalled()
			const commandArg = mockConverseStreamCommand.mock.calls[0][0]

			// Verify the image was properly formatted
			const imageBlock = commandArg.messages[0].content[0]
			expect(imageBlock).toHaveProperty("image")
			expect(imageBlock.image).toHaveProperty("format", "jpeg")
			expect(imageBlock.image.source).toHaveProperty("bytes")
			expect(imageBlock.image.source.bytes).toBeInstanceOf(Uint8Array)
		})

		it("should reject unsupported image formats", async () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "image",
							source: {
								type: "base64",
								data: mockImageData,
								media_type: "image/tiff" as "image/jpeg", // Type assertion to bypass TS
							},
						},
					],
				},
			]

			const generator = handler.createMessage("", messages)
			await expect(generator.next()).rejects.toThrow("Unsupported image format: tiff")
		})

		it("should handle multiple images in a single message", async () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user",
					content: [
						{
							type: "image",
							source: {
								type: "base64",
								data: mockImageData,
								media_type: "image/jpeg",
							},
						},
						{
							type: "text",
							text: "First image",
						},
						{
							type: "image",
							source: {
								type: "base64",
								data: mockImageData,
								media_type: "image/png",
							},
						},
						{
							type: "text",
							text: "Second image",
						},
					],
				},
			]

			const generator = handler.createMessage("", messages)
			await generator.next() // Start the generator

			// Verify the command was created with the right payload
			expect(mockConverseStreamCommand).toHaveBeenCalled()
			const commandArg = mockConverseStreamCommand.mock.calls[0][0]

			// Verify both images were properly formatted
			const firstImage = commandArg.messages[0].content[0]
			const secondImage = commandArg.messages[0].content[2]

			expect(firstImage).toHaveProperty("image")
			expect(firstImage.image).toHaveProperty("format", "jpeg")
			expect(secondImage).toHaveProperty("image")
			expect(secondImage.image).toHaveProperty("format", "png")
		})
	})
})
