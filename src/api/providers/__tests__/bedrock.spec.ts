// Mock AWS SDK credential providers
vi.mock("@aws-sdk/credential-providers", () => {
	const mockFromIni = vi.fn().mockReturnValue({
		accessKeyId: "profile-access-key",
		secretAccessKey: "profile-secret-key",
	})
	return { fromIni: mockFromIni }
})

// Mock BedrockRuntimeClient and ConverseStreamCommand
vi.mock("@aws-sdk/client-bedrock-runtime", () => {
	const mockSend = vi.fn().mockResolvedValue({
		stream: [],
	})
	const mockConverseStreamCommand = vi.fn()

	return {
		BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
			send: mockSend,
		})),
		ConverseStreamCommand: mockConverseStreamCommand,
		ConverseCommand: vi.fn(),
	}
})

import { AwsBedrockHandler } from "../bedrock"
import { ConverseStreamCommand, BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime"

import type { Anthropic } from "@anthropic-ai/sdk"

// Get access to the mocked functions
const mockConverseStreamCommand = vi.mocked(ConverseStreamCommand)
const mockBedrockRuntimeClient = vi.mocked(BedrockRuntimeClient)

describe("AwsBedrockHandler", () => {
	let handler: AwsBedrockHandler

	beforeEach(() => {
		// Clear all mocks before each test
		vi.clearAllMocks()

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

	describe("region mapping and cross-region inference", () => {
		describe("getPrefixForRegion", () => {
			it("should return correct prefix for US regions", () => {
				// Access private static method using type casting
				const getPrefixForRegion = (AwsBedrockHandler as any).getPrefixForRegion

				expect(getPrefixForRegion("us-east-1")).toBe("us.")
				expect(getPrefixForRegion("us-west-2")).toBe("us.")
				expect(getPrefixForRegion("us-gov-west-1")).toBe("ug.")
			})

			it("should return correct prefix for EU regions", () => {
				const getPrefixForRegion = (AwsBedrockHandler as any).getPrefixForRegion

				expect(getPrefixForRegion("eu-west-1")).toBe("eu.")
				expect(getPrefixForRegion("eu-central-1")).toBe("eu.")
				expect(getPrefixForRegion("eu-north-1")).toBe("eu.")
			})

			it("should return correct prefix for APAC regions", () => {
				const getPrefixForRegion = (AwsBedrockHandler as any).getPrefixForRegion

				expect(getPrefixForRegion("ap-southeast-1")).toBe("apac.")
				expect(getPrefixForRegion("ap-northeast-1")).toBe("apac.")
				expect(getPrefixForRegion("ap-south-1")).toBe("apac.")
			})

			it("should return undefined for unsupported regions", () => {
				const getPrefixForRegion = (AwsBedrockHandler as any).getPrefixForRegion

				expect(getPrefixForRegion("unknown-region")).toBeUndefined()
				expect(getPrefixForRegion("")).toBeUndefined()
				expect(getPrefixForRegion("invalid")).toBeUndefined()
			})
		})

		describe("isSystemInferenceProfile", () => {
			it("should return true for AWS inference profile prefixes", () => {
				const isSystemInferenceProfile = (AwsBedrockHandler as any).isSystemInferenceProfile

				expect(isSystemInferenceProfile("us.")).toBe(true)
				expect(isSystemInferenceProfile("eu.")).toBe(true)
				expect(isSystemInferenceProfile("apac.")).toBe(true)
			})

			it("should return false for other prefixes", () => {
				const isSystemInferenceProfile = (AwsBedrockHandler as any).isSystemInferenceProfile

				expect(isSystemInferenceProfile("ap.")).toBe(false)
				expect(isSystemInferenceProfile("apne1.")).toBe(false)
				expect(isSystemInferenceProfile("use1.")).toBe(false)
				expect(isSystemInferenceProfile("custom.")).toBe(false)
				expect(isSystemInferenceProfile("")).toBe(false)
			})
		})

		describe("parseBaseModelId", () => {
			it("should remove defined inference profile prefixes", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				// Access private method using type casting
				const parseBaseModelId = (handler as any).parseBaseModelId.bind(handler)

				expect(parseBaseModelId("us.anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(
					"anthropic.claude-3-5-sonnet-20241022-v2:0",
				)
				expect(parseBaseModelId("eu.anthropic.claude-3-haiku-20240307-v1:0")).toBe(
					"anthropic.claude-3-haiku-20240307-v1:0",
				)
				expect(parseBaseModelId("apac.anthropic.claude-3-opus-20240229-v1:0")).toBe(
					"anthropic.claude-3-opus-20240229-v1:0",
				)
			})

			it("should not modify model IDs without defined prefixes", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				const parseBaseModelId = (handler as any).parseBaseModelId.bind(handler)

				expect(parseBaseModelId("anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(
					"anthropic.claude-3-5-sonnet-20241022-v2:0",
				)
				expect(parseBaseModelId("amazon.titan-text-express-v1")).toBe("amazon.titan-text-express-v1")
			})

			it("should not modify model IDs with other prefixes", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				const parseBaseModelId = (handler as any).parseBaseModelId.bind(handler)

				// Other prefixes should be preserved as part of the model ID
				expect(parseBaseModelId("ap.anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(
					"ap.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)
				expect(parseBaseModelId("apne1.anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(
					"apne1.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)
				expect(parseBaseModelId("use1.anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe(
					"use1.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)
			})
		})

		describe("cross-region inference integration", () => {
			it("should apply correct prefix when cross-region inference is enabled", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsUseCrossRegionInference: true,
				})

				const model = handler.getModel()
				expect(model.id).toBe("us.anthropic.claude-3-5-sonnet-20241022-v2:0")
			})

			it("should apply correct prefix for different regions", () => {
				const euHandler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "eu-west-1",
					awsUseCrossRegionInference: true,
				})

				const apacHandler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "ap-southeast-1",
					awsUseCrossRegionInference: true,
				})

				expect(euHandler.getModel().id).toBe("eu.anthropic.claude-3-5-sonnet-20241022-v2:0")
				expect(apacHandler.getModel().id).toBe("apac.anthropic.claude-3-5-sonnet-20241022-v2:0")
			})

			it("should not apply prefix when cross-region inference is disabled", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsUseCrossRegionInference: false,
				})

				const model = handler.getModel()
				expect(model.id).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
			})

			it("should not apply prefix for unsupported regions", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "unknown-region",
					awsUseCrossRegionInference: true,
				})

				const model = handler.getModel()
				expect(model.id).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
			})
		})

		describe("ARN parsing with inference profiles", () => {
			it("should detect cross-region inference from ARN model ID", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				const parseArn = (handler as any).parseArn.bind(handler)

				const result = parseArn(
					"arn:aws:bedrock:us-east-1:123456789012:foundation-model/us.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)

				expect(result.isValid).toBe(true)
				expect(result.crossRegionInference).toBe(true)
				expect(result.modelId).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
			})

			it("should not detect cross-region inference for non-prefixed models", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				const parseArn = (handler as any).parseArn.bind(handler)

				const result = parseArn(
					"arn:aws:bedrock:us-east-1:123456789012:foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0",
				)

				expect(result.isValid).toBe(true)
				expect(result.crossRegionInference).toBe(false)
				expect(result.modelId).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
			})

			it("should detect cross-region inference for defined prefixes", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				const parseArn = (handler as any).parseArn.bind(handler)

				const euResult = parseArn(
					"arn:aws:bedrock:eu-west-1:123456789012:foundation-model/eu.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)
				const apacResult = parseArn(
					"arn:aws:bedrock:ap-southeast-1:123456789012:foundation-model/apac.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)

				expect(euResult.crossRegionInference).toBe(true)
				expect(euResult.modelId).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")

				expect(apacResult.crossRegionInference).toBe(true)
				expect(apacResult.modelId).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
			})

			it("should not detect cross-region inference for other prefixes", () => {
				const handler = new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
				})

				const parseArn = (handler as any).parseArn.bind(handler)

				// Other prefixes should not trigger cross-region inference detection
				const result = parseArn(
					"arn:aws:bedrock:us-east-1:123456789012:foundation-model/ap.anthropic.claude-3-5-sonnet-20241022-v2:0",
				)

				expect(result.crossRegionInference).toBe(false)
				expect(result.modelId).toBe("ap.anthropic.claude-3-5-sonnet-20241022-v2:0") // Should be preserved as-is
			})
		})
	})

	describe("image handling", () => {
		const mockImageData = Buffer.from("test-image-data").toString("base64")

		beforeEach(() => {
			// Reset the mocks before each test
			mockConverseStreamCommand.mockReset()
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
			const imageBlock = commandArg.messages![0].content![0]
			expect(imageBlock).toHaveProperty("image")
			expect(imageBlock.image).toHaveProperty("format", "jpeg")
			expect(imageBlock.image!.source).toHaveProperty("bytes")
			expect(imageBlock.image!.source!.bytes).toBeInstanceOf(Uint8Array)
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
			const firstImage = commandArg.messages![0].content![0]
			const secondImage = commandArg.messages![0].content![2]

			expect(firstImage).toHaveProperty("image")
			expect(firstImage.image).toHaveProperty("format", "jpeg")
			expect(secondImage).toHaveProperty("image")
			expect(secondImage.image).toHaveProperty("format", "png")
		})
	})

	describe("error handling and validation", () => {
		it("should handle invalid regions gracefully", () => {
			expect(() => {
				new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "", // Empty region
				})
			}).not.toThrow()
		})

		it("should validate ARN format and provide helpful error messages", () => {
			expect(() => {
				new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsCustomArn: "invalid-arn-format",
				})
			}).toThrow(/INVALID_ARN_FORMAT/)
		})

		it("should handle malformed ARNs with missing components", () => {
			expect(() => {
				new AwsBedrockHandler({
					apiModelId: "test",
					awsAccessKey: "test",
					awsSecretKey: "test",
					awsRegion: "us-east-1",
					awsCustomArn: "arn:aws:bedrock:us-east-1",
				})
			}).toThrow(/INVALID_ARN_FORMAT/)
		})
	})

	describe("model information and configuration", () => {
		it("should preserve model information after applying cross-region prefixes", () => {
			const handler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
				awsUseCrossRegionInference: true,
			})

			const model = handler.getModel()

			// Model ID should have prefix
			expect(model.id).toBe("us.anthropic.claude-3-5-sonnet-20241022-v2:0")

			// But model info should remain the same
			expect(model.info.maxTokens).toBe(8192)
			expect(model.info.contextWindow).toBe(200_000)
			expect(model.info.supportsImages).toBe(true)
			expect(model.info.supportsPromptCache).toBe(true)
		})

		it("should handle model configuration overrides correctly", () => {
			const handler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
				modelMaxTokens: 4096,
				awsModelContextWindow: 100_000,
			})

			const model = handler.getModel()

			// Should use override values
			expect(model.info.maxTokens).toBe(4096)
			expect(model.info.contextWindow).toBe(100_000)
		})

		it("should handle unknown models with sensible defaults", () => {
			const handler = new AwsBedrockHandler({
				apiModelId: "unknown.model.id",
				awsAccessKey: "test",
				awsSecretKey: "test",
				awsRegion: "us-east-1",
			})

			const model = handler.getModel()

			// Should fall back to default model info
			expect(model.info.maxTokens).toBeDefined()
			expect(model.info.contextWindow).toBeDefined()
			expect(typeof model.info.supportsImages).toBe("boolean")
			expect(typeof model.info.supportsPromptCache).toBe("boolean")
		})
	})
})
