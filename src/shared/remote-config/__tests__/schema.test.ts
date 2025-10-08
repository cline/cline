import { expect } from "chai"
import { describe, it } from "mocha"
import {
	AwsBedrockSettingsSchema,
	ModelInfoSchema,
	OpenAiCompatibleSchema,
	OpenAiModelInfoSchema,
	ProviderSchema,
	type RemoteConfig,
	RemoteConfigSchema,
} from "../schema"

describe("Remote Config Schema", () => {
	describe("ProviderSchema", () => {
		it("should accept valid provider names", () => {
			expect(() => ProviderSchema.parse("OpenAiCompatible")).to.not.throw()
			expect(() => ProviderSchema.parse("AwsBedrock")).to.not.throw()
		})

		it("should reject invalid provider names", () => {
			expect(() => ProviderSchema.parse("InvalidProvider")).to.throw()
			expect(() => ProviderSchema.parse("")).to.throw()
			expect(() => ProviderSchema.parse(123)).to.throw()
		})
	})

	describe("ModelInfoSchema", () => {
		it("should accept valid model info with all fields", () => {
			const validModelInfo = {
				maxTokens: 4096,
				contextWindow: 128000,
				inputPrice: 0.01,
				outputPrice: 0.02,
				supportsImages: true,
			}
			const result = ModelInfoSchema.parse(validModelInfo)
			expect(result).to.deep.equal(validModelInfo)
		})

		it("should accept valid model info with optional fields missing", () => {
			const minimalModelInfo = {}
			expect(() => ModelInfoSchema.parse(minimalModelInfo)).to.not.throw()
		})

		it("should accept valid model info with partial fields", () => {
			const partialModelInfo = {
				maxTokens: 2048,
				supportsImages: false,
			}
			expect(() => ModelInfoSchema.parse(partialModelInfo)).to.not.throw()
		})

		it("should reject invalid field types", () => {
			expect(() => ModelInfoSchema.parse({ maxTokens: "4096" })).to.throw()
			expect(() => ModelInfoSchema.parse({ supportsImages: "true" })).to.throw()
		})
	})

	describe("OpenAiModelInfoSchema", () => {
		it("should accept valid OpenAI model info", () => {
			const validInfo = {
				temperature: 0.7,
				isR1FormatRequired: true,
			}
			const result = OpenAiModelInfoSchema.parse(validInfo)
			expect(result).to.deep.equal(validInfo)
		})

		it("should accept empty object", () => {
			expect(() => OpenAiModelInfoSchema.parse({})).to.not.throw()
		})

		it("should reject invalid types", () => {
			expect(() => OpenAiModelInfoSchema.parse({ temperature: "hot" })).to.throw()
			expect(() => OpenAiModelInfoSchema.parse({ isR1FormatRequired: 1 })).to.throw()
		})
	})

	describe("OpenAiCompatibleSchema", () => {
		it("should accept valid OpenAI compatible settings", () => {
			const validSettings = {
				modelIds: ["gpt-4", "gpt-3.5-turbo"],
				openAiBaseUrl: "https://api.openai.com/v1",
				openAiHeaders: { "X-Custom-Header": "value" },
				azureApiVersion: "2024-02-15-preview",
			}
			const result = OpenAiCompatibleSchema.parse(validSettings)
			expect(result).to.deep.equal(validSettings)
		})

		it("should apply default empty array for modelIds", () => {
			const result = OpenAiCompatibleSchema.parse({})
			expect(result.modelIds).to.deep.equal([])
			expect(result.openAiHeaders).to.deep.equal({})
		})

		it("should reject invalid field types", () => {
			expect(() => OpenAiCompatibleSchema.parse({ modelIds: "not-an-array" })).to.throw()
			expect(() => OpenAiCompatibleSchema.parse({ openAiHeaders: "not-an-object" })).to.throw()
		})

		it("should accept headers as record of strings", () => {
			const settings = {
				openAiHeaders: {
					Authorization: "Bearer token",
					"Content-Type": "application/json",
				},
			}
			const result = OpenAiCompatibleSchema.parse(settings)
			expect(result.openAiHeaders).to.deep.equal(settings.openAiHeaders)
		})
	})

	describe("AwsBedrockSettingsSchema", () => {
		it("should accept valid AWS Bedrock settings", () => {
			const validSettings = {
				modelIds: ["anthropic.claude-v2", "anthropic.claude-instant-v1"],
				awsBedrockCustomSelected: true,
				awsBedrockCustomModelBaseId: "custom-model",
				awsRegion: "us-east-1",
				awsUseCrossRegionInference: true,
				awsBedrockUsePromptCache: true,
				awsBedrockEndpoint: "https://bedrock.us-east-1.amazonaws.com",
			}
			const result = AwsBedrockSettingsSchema.parse(validSettings)
			expect(result).to.deep.equal(validSettings)
		})

		it("should apply default empty array for modelIds", () => {
			const result = AwsBedrockSettingsSchema.parse({})
			expect(result.modelIds).to.deep.equal([])
		})

		it("should reject invalid field types", () => {
			expect(() => AwsBedrockSettingsSchema.parse({ modelIds: "not-an-array" })).to.throw()
			expect(() => AwsBedrockSettingsSchema.parse({ awsBedrockCustomSelected: "true" })).to.throw()
		})
	})

	describe("RemoteConfigSchema", () => {
		it("should accept valid complete remote config", () => {
			const validConfig: RemoteConfig = {
				version: "v1",
				telemetryEnabled: true,
				mcpMarketplaceEnabled: true,
				yoloModeAllowed: false,
				providerSettings: {
					OpenAiCompatible: {
						modelIds: ["gpt-4"],
						openAiBaseUrl: "https://api.openai.com/v1",
						openAiHeaders: {},
					},
					AwsBedrock: {
						modelIds: ["anthropic.claude-v2"],
						awsRegion: "us-west-2",
					},
				},
			}
			const result = RemoteConfigSchema.parse(validConfig)
			expect(result).to.deep.equal(validConfig)
		})

		it("should require version field", () => {
			const configWithoutVersion = {}
			expect(() => RemoteConfigSchema.parse(configWithoutVersion)).to.throw()
		})

		it("should accept minimal valid config", () => {
			const minimalConfig = {
				version: "v1",
			}
			expect(() => RemoteConfigSchema.parse(minimalConfig)).to.not.throw()
		})

		it("should accept config with general settings only", () => {
			const configWithGeneralSettings = {
				version: "v1",
				telemetryEnabled: false,
				mcpMarketplaceEnabled: false,
				yoloModeAllowed: true,
			}
			const result = RemoteConfigSchema.parse(configWithGeneralSettings)
			expect(result.telemetryEnabled).to.equal(false)
			expect(result.mcpMarketplaceEnabled).to.equal(false)
			expect(result.yoloModeAllowed).to.equal(true)
		})

		it("should accept config with OpenAI compatible provider only", () => {
			const config = {
				version: "v1",
				providerSettings: {
					OpenAiCompatible: {
						modelIds: ["gpt-4", "gpt-3.5-turbo"],
						openAiBaseUrl: "https://api.openai.com/v1",
					},
				},
			}
			expect(() => RemoteConfigSchema.parse(config)).to.not.throw()
		})

		it("should accept config with AWS Bedrock provider only", () => {
			const config = {
				version: "v1",
				providerSettings: {
					AwsBedrock: {
						modelIds: ["anthropic.claude-v2"],
						awsRegion: "us-east-1",
					},
				},
			}
			expect(() => RemoteConfigSchema.parse(config)).to.not.throw()
		})

		it("should accept config with multiple providers", () => {
			const config = {
				version: "v1",
				providerSettings: {
					OpenAiCompatible: {
						modelIds: ["gpt-4"],
					},
					AwsBedrock: {
						modelIds: ["anthropic.claude-v2"],
					},
				},
			}
			const result = RemoteConfigSchema.parse(config)
			expect(result.providerSettings).to.have.property("OpenAiCompatible")
			expect(result.providerSettings).to.have.property("AwsBedrock")
		})

		it("should reject invalid version type", () => {
			expect(() => RemoteConfigSchema.parse({ version: 123 })).to.throw()
		})

		it("should reject invalid telemetry setting type", () => {
			expect(() =>
				RemoteConfigSchema.parse({
					version: "v1",
					telemetryEnabled: "yes",
				}),
			).to.throw()
		})

		it("should allow undefined optional provider settings", () => {
			const config = {
				version: "v1",
				// providerSettings is undefined
			}
			expect(() => RemoteConfigSchema.parse(config)).to.not.throw()
		})

		it("should handle complex nested validation", () => {
			const config = {
				version: "v1",
				telemetryEnabled: true,
				mcpMarketplaceEnabled: false,
				yoloModeAllowed: true,
				providerSettings: {
					OpenAiCompatible: {
						modelIds: ["model1", "model2", "model3"],
						openAiBaseUrl: "https://custom.openai.api/v1",
						openAiHeaders: {
							"X-API-Key": "secret",
							"X-Custom": "value",
						},
						azureApiVersion: "2024-02-15-preview",
					},
					AwsBedrock: {
						modelIds: ["bedrock1", "bedrock2"],
						awsBedrockCustomSelected: true,
						awsBedrockCustomModelBaseId: "my-custom-model",
						awsRegion: "eu-west-1",
						awsUseCrossRegionInference: false,
						awsBedrockUsePromptCache: true,
						awsBedrockEndpoint: "https://custom-bedrock.endpoint",
					},
				},
			}
			const result = RemoteConfigSchema.parse(config)
			expect(result.version).to.equal("v1")
			expect(result.providerSettings?.OpenAiCompatible?.modelIds).to.have.lengthOf(3)
			expect(result.providerSettings?.AwsBedrock?.modelIds).to.have.lengthOf(2)
		})
	})

	describe("Type Inference", () => {
		it("should properly infer RemoteConfig type", () => {
			const config: RemoteConfig = {
				version: "v1",
				telemetryEnabled: true,
			}
			// TypeScript compilation will fail if type inference is wrong
			expect(config.version).to.be.a("string")
		})

		it("should allow optional fields to be undefined", () => {
			const config: RemoteConfig = {
				version: "v1",
				// All other fields are optional and can be undefined
			}
			expect(config.telemetryEnabled).to.be.undefined
			expect(config.providerSettings).to.be.undefined
		})
	})
})
