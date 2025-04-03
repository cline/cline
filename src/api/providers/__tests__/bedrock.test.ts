// Mock AWS SDK credential providers
jest.mock("@aws-sdk/credential-providers", () => {
	const mockFromIni = jest.fn().mockReturnValue({
		accessKeyId: "profile-access-key",
		secretAccessKey: "profile-secret-key",
	})
	return { fromIni: mockFromIni }
})

import { AwsBedrockHandler } from "../bedrock"
import { MessageContent } from "../../../shared/api"
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime"
import { Anthropic } from "@anthropic-ai/sdk"
const { fromIni } = require("@aws-sdk/credential-providers")
import { logger } from "../../../utils/logging"

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
			// Mock the parseArn method before creating the handler
			const originalParseArn = AwsBedrockHandler.prototype["parseArn"]
			const parseArnMock = jest.fn().mockImplementation(function (this: any, arn: string, region?: string) {
				return originalParseArn.call(this, arn, region)
			})
			AwsBedrockHandler.prototype["parseArn"] = parseArnMock

			try {
				// Create a handler with a custom ARN that includes the apne3. region prefix
				const customArnHandler = new AwsBedrockHandler({
					apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
					awsAccessKey: "test-access-key",
					awsSecretKey: "test-secret-key",
					awsRegion: "ap-northeast-3", // Osaka region
					awsCustomArn:
						"arn:aws:bedrock:ap-northeast-3:123456789012:inference-profile/apne3.anthropic.claude-3-5-sonnet-20241022-v2:0",
				})

				const modelInfo = customArnHandler.getModel()

				expect(modelInfo.id).toBe(
					"arn:aws:bedrock:ap-northeast-3:123456789012:inference-profile/apne3.anthropic.claude-3-5-sonnet-20241022-v2:0",
				),
					// Verify the model info is defined
					expect(modelInfo.info).toBeDefined()

				// Verify parseArn was called with the correct ARN
				expect(parseArnMock).toHaveBeenCalledWith(
					"arn:aws:bedrock:ap-northeast-3:123456789012:inference-profile/apne3.anthropic.claude-3-5-sonnet-20241022-v2:0",
					"ap-northeast-3",
				)

				// Verify the model ID was correctly extracted from the ARN (without the region prefix)
				expect((customArnHandler as any).arnInfo.modelId).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")

				// Verify cross-region inference flag is false since apne3 is a prefix for a single region
				expect((customArnHandler as any).arnInfo.crossRegionInference).toBe(false)
			} finally {
				// Restore the original method
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
			// Should fall back to default prompt router model
			expect(modelInfo.id).toBe(
				"arn:aws:bedrock:ap-northeast-3:123456789012:default-prompt-router/my_router_arn_no_model",
			) // bedrockDefaultPromptRouterModelId
			expect(modelInfo.info).toBeDefined()
			expect(modelInfo.info.maxTokens).toBe(4096)
		})
	})
})
