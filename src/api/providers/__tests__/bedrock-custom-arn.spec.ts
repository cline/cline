// npx vitest run src/api/providers/__tests__/bedrock-custom-arn.spec.ts

import { vitest, describe, it, expect } from "vitest"
import { AwsBedrockHandler } from "../bedrock"
import { ApiHandlerOptions } from "../../../shared/api"
import { logger } from "../../../utils/logging"

// Mock the logger
vitest.mock("../../../utils/logging", () => ({
	logger: {
		debug: vitest.fn(),
		info: vitest.fn(),
		warn: vitest.fn(),
		error: vitest.fn(),
		fatal: vitest.fn(),
		child: vitest.fn().mockReturnValue({
			debug: vitest.fn(),
			info: vitest.fn(),
			warn: vitest.fn(),
			error: vitest.fn(),
			fatal: vitest.fn(),
		}),
	},
}))

// Mock AWS SDK
vitest.mock("@aws-sdk/client-bedrock-runtime", () => {
	const mockModule = {
		lastCommandInput: null as Record<string, any> | null,
		mockSend: vitest.fn().mockImplementation(async function () {
			return {
				output: new TextEncoder().encode(JSON.stringify({ content: "Test response" })),
			}
		}),
		mockConverseCommand: vitest.fn(function (input) {
			mockModule.lastCommandInput = input
			return { input }
		}),
		MockBedrockRuntimeClient: class {
			public config: any
			public send: any

			constructor(config: { region?: string }) {
				this.config = config
				this.send = mockModule.mockSend
			}
		},
	}

	return {
		BedrockRuntimeClient: mockModule.MockBedrockRuntimeClient,
		ConverseCommand: mockModule.mockConverseCommand,
		ConverseStreamCommand: vitest.fn(),
		__mock: mockModule, // Expose mock internals for testing
	}
})

describe("Bedrock ARN Handling", () => {
	// Helper function to create a handler with specific options
	const createHandler = (options: Partial<ApiHandlerOptions> = {}) => {
		const defaultOptions: ApiHandlerOptions = {
			apiModelId: "anthropic.claude-3-sonnet-20240229-v1:0",
			awsRegion: "us-east-1",
			...options,
		}
		return new AwsBedrockHandler(defaultOptions)
	}

	// Direct tests for parseArn function
	describe("parseArn direct tests", () => {
		it("should correctly extract modelType and modelId from foundation-model ARN", () => {
			const handler = createHandler()
			//note: properly formatted foundation-model ARNs don't have an account id.
			const arn = "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0"

			// Access the private method using type casting
			const result = (handler as any).parseArn(arn, "us-east-1")

			// Verify the result contains the expected values
			expect(result.isValid).toBe(true)
			expect(result.modelType).toBe("foundation-model")

			//verify the id is not the ARN for foundation models, but the ID
			expect(result.modelId).toBe("anthropic.claude-3-sonnet-20240229-v1:0")
			expect(result.crossRegionInference).toBe(false)
		})

		it("should correctly extract modelType and modelId from inference-profile ARN", () => {
			const handler = createHandler()
			const arn = "arn:aws:bedrock:us-west-2:123456789012:inference-profile/custom-profile"

			// Access the private method using type casting
			const result = (handler as any).parseArn(arn, "us-west-2")

			// Verify the result contains the expected values
			expect(result.isValid).toBe(true)
			// The region is not set in the result for normal ARNs
			expect(result.modelType).toBe("inference-profile")
			expect(result.modelId).toBe("custom-profile")
			expect(result.crossRegionInference).toBe(false)
		})

		it("should correctly extract modelType and modelId from prompt-router ARN", () => {
			const handler = createHandler()
			const arn = "arn:aws:bedrock:eu-west-1:123456789012:prompt-router/custom-router-name"

			// Access the private method using type casting
			const result = (handler as any).parseArn(arn, "eu-west-1")

			// Verify the result contains the expected values
			expect(result.isValid).toBe(true)
			// The region is not set in the result for normal ARNs
			expect(result.modelType).toBe("prompt-router")
			expect(result.modelId).toBe("custom-router-name")
			expect(result.crossRegionInference).toBe(false)
		})

		it("should set crossRegionInference to true when a known region prefix is found in the model ID", () => {
			const handler = createHandler()
			const arn =
				"arn:aws:bedrock:us-east-1:123456789012:foundation-model/us.anthropic.claude-3-sonnet-20240229-v1:0"

			// Access the private method using type casting
			const result = (handler as any).parseArn(arn, "us-east-1")

			// Verify crossRegionInference is true
			expect(result.crossRegionInference).toBe(true)
			expect(result.modelId).toBe("anthropic.claude-3-sonnet-20240229-v1:0")
			expect(result.region).toBe("us-east-1")
		})

		it("should set crossRegionInference to true for model IDs with apac (4 digit) region prefix", () => {
			// This test uses a model ID with a region prefix in a different way
			// We'll use a real ARN with a model ID that includes a region prefix
			const handler = createHandler()

			// Use a model ID with eu. prefix which should be detected
			const arn =
				"arn:aws:bedrock:ap-east-1:123456789012:foundation-model/apac.anthropic.claude-3-sonnet-20240229-v1:0"

			// Access the private method using type casting
			const result = (handler as any).parseArn(arn, "us-east-1")

			// Verify crossRegionInference is true
			expect(result.crossRegionInference).toBe(true)
			// The eu. prefix should be removed from the model ID
			expect(result.modelId).toBe("anthropic.claude-3-sonnet-20240229-v1:0")
		})

		it("should include region mismatch warning but still extract modelType and modelId", () => {
			const handler = createHandler()
			const arn = "arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0"

			// Access the private method using type casting with mismatched region
			const result = (handler as any).parseArn(arn, "us-east-1")

			// Verify the result contains the expected values including error message
			expect(result.isValid).toBe(true)
			// In case of region mismatch, the region is set to the ARN region
			expect(result.region).toBe("eu-west-1")
			expect(result.modelType).toBe("foundation-model")
			expect(result.modelId).toBe("anthropic.claude-3-sonnet-20240229-v1:0")
			expect(result.errorMessage).toContain("Region mismatch")
			expect(result.crossRegionInference).toBe(false)
		})

		it("should return isValid: false for simple ARN format", () => {
			const handler = createHandler()
			const arn = "arn:aws:bedrock:us-east-1:123456789012:some-other-resource"

			// Access the private method using type casting
			const result = (handler as any).parseArn(arn, "us-east-1")

			// Verify the result indicates invalid ARN
			expect(result.isValid).toBe(false)
			expect(result.region).toBeUndefined()
			expect(result.errorMessage).toContain("Invalid ARN format")
			expect(result.crossRegionInference).toBe(false)
			expect(result.modelType).toBeUndefined()
			expect(result.modelId).toBeUndefined()
		})

		it("should return isValid: false for invalid ARN format", () => {
			const handler = createHandler()
			const arn = "invalid-arn-format"

			// Access the private method using type casting
			const result = (handler as any).parseArn(arn)

			// Verify the result indicates invalid ARN
			expect(result.isValid).toBe(false)
			expect(result.region).toBeUndefined()
			expect(result.errorMessage).toContain("Invalid ARN format")
			expect(result.crossRegionInference).toBe(false)
			expect(result.modelType).toBeUndefined()
			expect(result.modelId).toBeUndefined()
		})
	})

	// Integration tests for ARN handling in the constructor and other methods
	describe("ARN handling in constructor and methods", () => {
		it("should extract model ID from the custom ARN for foundation-model ARNs", async () => {
			const mockOptions: ApiHandlerOptions = {
				apiModelId: "custom-arn",
				//properly formatted foundation-model ARNs don't have an account id
				awsCustomArn: "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
				awsRegion: "us-east-1",
			}

			const handler = new AwsBedrockHandler(mockOptions)
			const model = handler.getModel()

			// For foundation-model ARNs, the model ID is extracted from the ARN
			expect(model.id).toBe("anthropic.claude-3-sonnet-20240229-v1:0")
			expect(model.info).toHaveProperty("maxTokens")
			expect(model.info).toHaveProperty("contextWindow")
			expect(model.info).toHaveProperty("supportsPromptCache")
		})

		it("should extract region from ARN and use it for client configuration", () => {
			// Test with ARN in eu-west-1 but config region in us-east-1
			const handler = createHandler({
				awsRegion: "us-east-1",
				awsCustomArn:
					"arn:aws:bedrock:eu-west-1:123456789012:inference-profile/anthropic.claude-3-sonnet-20240229-v1:0",
			})

			// Verify the client was created with the ARN region, not the provided region
			expect((handler as any).client.config.region).toBe("eu-west-1")
		})

		it("should log region mismatch warning when ARN region differs from provided region", () => {
			// Spy on logger.info which is called when there's a region mismatch
			const infoSpy = vitest.spyOn(logger, "info")

			// Create handler with ARN region different from provided region
			const arn =
				"arn:aws:bedrock:eu-west-1:123456789012:inference-profile/anthropic.claude-3-sonnet-20240229-v1:0"

			createHandler({
				awsCustomArn: arn,
				awsRegion: "us-east-1", // Different from ARN region
			})

			// Verify logger was called with region mismatch warning
			expect(infoSpy).toHaveBeenCalledWith(
				expect.stringContaining("Region mismatch"),
				expect.objectContaining({
					selectedRegion: "us-east-1",
					arnRegion: "eu-west-1",
				}),
			)
		})
	})
})
