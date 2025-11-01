import { expect } from "chai"
import { describe, it } from "mocha"
import {
	AwsBedrockSettingsSchema,
	ClineSettingsSchema,
	OpenAiCompatibleSchema,
	type RemoteConfig,
	RemoteConfigSchema,
} from "../schema"

describe("Remote Config Schema", () => {
	describe("OpenAiCompatibleSchema", () => {
		it("should accept valid OpenAI compatible settings", () => {
			const validSettings = {
				models: [
					{
						id: "gpt-4",
						temperature: 0.7,
						isR1FormatRequired: true,
						maxTokens: 4096,
						contextWindow: 128000,
						inputPrice: 0.03,
						outputPrice: 0.06,
						supportsImages: true,
					},
					{
						id: "gpt-3.5-turbo",
						temperature: 0.7,
						maxTokens: 4096,
						contextWindow: 16000,
						inputPrice: 0.001,
						outputPrice: 0.002,
						supportsImages: false,
					},
				],
				openAiBaseUrl: "https://api.openai.com/v1",
				openAiHeaders: { "X-Custom-Header": "value" },
				azureApiVersion: "2024-02-15-preview",
			}
			const result = OpenAiCompatibleSchema.parse(validSettings)
			expect(result).to.deep.equal(validSettings)
		})

		it("should have undefined for models and openAiHeaders by default", () => {
			const result = OpenAiCompatibleSchema.parse({})
			expect(result.models).to.be.undefined
			expect(result.openAiHeaders).to.be.undefined
		})

		it("should reject invalid field types", () => {
			expect(() => OpenAiCompatibleSchema.parse({ models: "not-an-array" })).to.throw()
			expect(() => OpenAiCompatibleSchema.parse({ openAiHeaders: "not-an-object" })).to.throw()
		})

		it("should reject models with missing id field", () => {
			expect(() =>
				OpenAiCompatibleSchema.parse({
					models: [{ temperature: 0.7 }],
				}),
			).to.throw()
		})

		it("should accept models with only id field", () => {
			const settings = {
				models: [{ id: "gpt-4" }],
			}
			expect(() => OpenAiCompatibleSchema.parse(settings)).to.not.throw()
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

	describe("ClineSettingsSchema", () => {
		it("should accept valid Cline provider settings", () => {
			const validSettings = {
				models: [{ id: "claude-3-5-sonnet-20241022" }, { id: "claude-3-5-haiku-20241022" }],
			}
			const result = ClineSettingsSchema.parse(validSettings)
			expect(result).to.deep.equal(validSettings)
		})

		it("should accept empty settings object", () => {
			const result = ClineSettingsSchema.parse({})
			expect(result.models).to.be.undefined
		})

		it("should accept models with only id field", () => {
			const settings = {
				models: [{ id: "claude-3-5-sonnet-20241022" }],
			}
			expect(() => ClineSettingsSchema.parse(settings)).to.not.throw()
		})

		it("should reject models with missing id field", () => {
			expect(() =>
				ClineSettingsSchema.parse({
					models: [{}],
				}),
			).to.throw()
		})
	})

	describe("AwsBedrockSettingsSchema", () => {
		it("should accept valid AWS Bedrock settings", () => {
			const validSettings = {
				models: [
					{ id: "anthropic.claude-v2", thinkingBudgetTokens: 1600 },
					{ id: "anthropic.claude-instant-v1", thinkingBudgetTokens: 800 },
				],
				customModels: [
					{ name: "my-custom-model", baseModelId: "anthropic.claude-v2" },
					{ name: "another-model", baseModelId: "anthropic.claude-instant-v1" },
				],
				awsRegion: "us-east-1",
				awsUseCrossRegionInference: true,
				awsBedrockUsePromptCache: true,
				awsBedrockEndpoint: "https://bedrock.us-east-1.amazonaws.com",
			}
			const result = AwsBedrockSettingsSchema.parse(validSettings)
			expect(result).to.deep.equal(validSettings)
		})

		it("should accept empty settings object", () => {
			const result = AwsBedrockSettingsSchema.parse({})
			expect(result.models).to.be.undefined
			expect(result.customModels).to.be.undefined
		})

		it("should accept models with only id field", () => {
			const settings = {
				models: [{ id: "anthropic.claude-v2" }],
			}
			expect(() => AwsBedrockSettingsSchema.parse(settings)).to.not.throw()
		})

		it("should accept models with thinkingBudgetTokens", () => {
			const settings = {
				models: [
					{ id: "anthropic.claude-v2", thinkingBudgetTokens: 1600 },
					{ id: "anthropic.claude-instant-v1", thinkingBudgetTokens: 800 },
				],
			}
			const result = AwsBedrockSettingsSchema.parse(settings)
			expect(result.models).to.have.lengthOf(2)
			expect(result.models?.[0].thinkingBudgetTokens).to.equal(1600)
		})

		it("should accept custom models array", () => {
			const settings = {
				customModels: [
					{ name: "custom-1", baseModelId: "base-model-1", thinkingBudgetTokens: 1600 },
					{ name: "custom-2", baseModelId: "base-model-2" },
				],
			}
			expect(() => AwsBedrockSettingsSchema.parse(settings)).to.not.throw()
		})

		it("should reject invalid field types", () => {
			expect(() => AwsBedrockSettingsSchema.parse({ models: "not-an-array" })).to.throw()
			expect(() => AwsBedrockSettingsSchema.parse({ customModels: "not-an-array" })).to.throw()
		})

		it("should reject models with missing id field", () => {
			expect(() =>
				AwsBedrockSettingsSchema.parse({
					models: [{ thinkingBudgetTokens: 1600 }],
				}),
			).to.throw()
		})

		it("should reject custom models with missing fields", () => {
			expect(() =>
				AwsBedrockSettingsSchema.parse({
					customModels: [{ name: "missing-base-model" }],
				}),
			).to.throw()
			expect(() =>
				AwsBedrockSettingsSchema.parse({
					customModels: [{ baseModelId: "missing-name" }],
				}),
			).to.throw()
		})
	})

	describe("MCPSettingsSchema", () => {
		it("should reject servers with a missing id", () => {
			const config = {
				version: "v1",
				allowedMCPServers: [{}],
			}

			expect(() => RemoteConfigSchema.parse(config)).to.throw()
		})

		it("should accept valid MCP settings", () => {
			const config = {
				version: "v1",
				mcpMarketplaceEnabled: true,
				allowedMCPServers: [{ id: "https://github.com/mcp/filesystem" }, { id: "https://github.com/mcp/github" }],
			}

			const result = RemoteConfigSchema.parse(config)
			expect(result.mcpMarketplaceEnabled).to.equal(true)
			expect(result.allowedMCPServers).to.deep.equal(config.allowedMCPServers)
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
						models: [{ id: "gpt-4" }],
						openAiBaseUrl: "https://api.openai.com/v1",
						openAiHeaders: {},
					},
					AwsBedrock: {
						models: [{ id: "anthropic.claude-v2" }],
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
						models: [{ id: "gpt-4" }, { id: "gpt-3.5-turbo" }],
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
						models: [{ id: "anthropic.claude-v2" }],
						awsRegion: "us-east-1",
					},
				},
			}
			expect(() => RemoteConfigSchema.parse(config)).to.not.throw()
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

		it("should handle complete config with all fields", () => {
			const config = {
				version: "v1",
				telemetryEnabled: true,
				mcpMarketplaceEnabled: false,
				allowedMCPServers: [{ id: "https://github.com/mcp/filesystem" }, { id: "https://github.com/mcp/github" }],
				yoloModeAllowed: true,
				openTelemetryEnabled: true,
				openTelemetryMetricsExporter: "otlp",
				openTelemetryLogsExporter: "otlp",
				openTelemetryOtlpProtocol: "http/json",
				openTelemetryOtlpEndpoint: "http://localhost:4318",
				openTelemetryOtlpMetricsProtocol: "http/json",
				openTelemetryOtlpMetricsEndpoint: "http://localhost:4318/v1/metrics",
				openTelemetryOtlpLogsProtocol: "http/json",
				openTelemetryOtlpLogsEndpoint: "http://localhost:4318/v1/logs",
				openTelemetryMetricExportInterval: 60000,
				openTelemetryOtlpInsecure: false,
				openTelemetryLogBatchSize: 512,
				openTelemetryLogBatchTimeout: 5000,
				openTelemetryLogMaxQueueSize: 2048,
				globalRules: [
					{
						alwaysEnabled: true,
						name: "company-standards.md",
						contents: "# Company Standards\n\nAll code must follow these standards...",
					},
					{
						alwaysEnabled: false,
						name: "optional-guidelines.md",
						contents: "# Optional Guidelines\n\nConsider these best practices...",
					},
				],
				globalWorkflows: [
					{
						alwaysEnabled: true,
						name: "deployment-workflow.md",
						contents: "# Deployment Workflow\n\n1. Run tests\n2. Build\n3. Deploy",
					},
				],
				providerSettings: {
					OpenAiCompatible: {
						models: [
							{
								id: "gpt-4",
								temperature: 0.7,
								isR1FormatRequired: false,
								maxTokens: 4096,
								contextWindow: 128000,
								inputPrice: 0.03,
								outputPrice: 0.06,
								supportsImages: true,
							},
							{
								id: "gpt-3.5-turbo",
								temperature: 0.8,
								isR1FormatRequired: false,
								maxTokens: 4096,
								contextWindow: 16000,
								inputPrice: 0.001,
								outputPrice: 0.002,
								supportsImages: false,
							},
						],
						openAiBaseUrl: "https://custom.openai.api/v1",
						openAiHeaders: {
							"X-API-Key": "secret-key",
							"X-Custom-Header": "custom-value",
						},
						azureApiVersion: "2024-02-15-preview",
					},
					AwsBedrock: {
						models: [
							{ id: "anthropic.claude-v2", thinkingBudgetTokens: 1600 },
							{ id: "anthropic.claude-instant-v1", thinkingBudgetTokens: 800 },
						],
						customModels: [
							{
								name: "my-custom-model",
								baseModelId: "anthropic.claude-v2",
								thinkingBudgetTokens: 2000,
							},
							{
								name: "another-custom",
								baseModelId: "anthropic.claude-instant-v1",
								thinkingBudgetTokens: 1000,
							},
						],
						awsRegion: "eu-west-1",
						awsUseCrossRegionInference: false,
						awsUseGlobalInference: true,
						awsBedrockUsePromptCache: true,
						awsBedrockEndpoint: "https://custom-bedrock.endpoint",
					},
					Cline: {
						models: [{ id: "claude-3-5-sonnet-20241022" }, { id: "claude-3-5-haiku-20241022" }],
					},
					Vertex: {
						models: [
							{ id: "claude-3-5-sonnet-v2@20241022", thinkingBudgetTokens: 1600 },
							{ id: "claude-3-5-haiku@20241022" },
						],
						vertexProjectId: "my-gcp-project",
						vertexRegion: "us-central1",
					},
				},
			}
			const result = RemoteConfigSchema.parse(config)

			// Verify all top-level fields
			expect(result.version).to.equal("v1")
			expect(result.telemetryEnabled).to.equal(true)
			expect(result.yoloModeAllowed).to.equal(true)

			expect(result.mcpMarketplaceEnabled).to.equal(false)
			expect(result.allowedMCPServers).to.deep.equal(config.allowedMCPServers)

			// Verify OpenAI Compatible settings
			expect(result.providerSettings?.OpenAiCompatible?.models).to.have.lengthOf(2)
			expect(result.providerSettings?.OpenAiCompatible?.openAiBaseUrl).to.equal("https://custom.openai.api/v1")
			expect(result.providerSettings?.OpenAiCompatible?.azureApiVersion).to.equal("2024-02-15-preview")

			// Verify AWS Bedrock settings
			expect(result.providerSettings?.AwsBedrock?.models).to.have.lengthOf(2)
			expect(result.providerSettings?.AwsBedrock?.customModels).to.have.lengthOf(2)
			expect(result.providerSettings?.AwsBedrock?.awsRegion).to.equal("eu-west-1")
			expect(result.providerSettings?.AwsBedrock?.awsUseCrossRegionInference).to.equal(false)
			expect(result.providerSettings?.AwsBedrock?.awsUseGlobalInference).to.equal(true)
			expect(result.providerSettings?.AwsBedrock?.awsBedrockUsePromptCache).to.equal(true)
			expect(result.providerSettings?.AwsBedrock?.awsBedrockEndpoint).to.equal("https://custom-bedrock.endpoint")

			// Verify Cline settings
			expect(result.providerSettings?.Cline?.models).to.have.lengthOf(2)
			expect(result.providerSettings?.Cline?.models?.[0].id).to.equal("claude-3-5-sonnet-20241022")
			expect(result.providerSettings?.Cline?.models?.[1].id).to.equal("claude-3-5-haiku-20241022")

			// Verify Vertex settings
			expect(result.providerSettings?.Vertex?.models).to.have.lengthOf(2)
			expect(result.providerSettings?.Vertex?.models?.[0].id).to.equal("claude-3-5-sonnet-v2@20241022")
			expect(result.providerSettings?.Vertex?.models?.[0].thinkingBudgetTokens).to.equal(1600)
			expect(result.providerSettings?.Vertex?.models?.[1].id).to.equal("claude-3-5-haiku@20241022")
			expect(result.providerSettings?.Vertex?.models?.[1].thinkingBudgetTokens).to.be.undefined
			expect(result.providerSettings?.Vertex?.vertexProjectId).to.equal("my-gcp-project")
			expect(result.providerSettings?.Vertex?.vertexRegion).to.equal("us-central1")

			// Verify OpenTelemetry settings
			expect(result.openTelemetryEnabled).to.equal(true)
			expect(result.openTelemetryMetricsExporter).to.equal("otlp")
			expect(result.openTelemetryLogsExporter).to.equal("otlp")
			expect(result.openTelemetryOtlpProtocol).to.equal("http/json")
			expect(result.openTelemetryOtlpEndpoint).to.equal("http://localhost:4318")
			expect(result.openTelemetryOtlpMetricsProtocol).to.equal("http/json")
			expect(result.openTelemetryOtlpMetricsEndpoint).to.equal("http://localhost:4318/v1/metrics")
			expect(result.openTelemetryOtlpLogsProtocol).to.equal("http/json")
			expect(result.openTelemetryOtlpLogsEndpoint).to.equal("http://localhost:4318/v1/logs")
			expect(result.openTelemetryMetricExportInterval).to.equal(60000)
			expect(result.openTelemetryOtlpInsecure).to.equal(false)
			expect(result.openTelemetryLogBatchSize).to.equal(512)
			expect(result.openTelemetryLogBatchTimeout).to.equal(5000)
			expect(result.openTelemetryLogMaxQueueSize).to.equal(2048)

			// Verify Global Instructions settings
			expect(result.globalRules).to.have.lengthOf(2)
			expect(result.globalRules?.[0].alwaysEnabled).to.equal(true)
			expect(result.globalRules?.[0].name).to.equal("company-standards.md")
			expect(result.globalRules?.[0].contents).to.include("Company Standards")
			expect(result.globalRules?.[1].alwaysEnabled).to.equal(false)
			expect(result.globalRules?.[1].name).to.equal("optional-guidelines.md")

			expect(result.globalWorkflows).to.have.lengthOf(1)
			expect(result.globalWorkflows?.[0].alwaysEnabled).to.equal(true)
			expect(result.globalWorkflows?.[0].name).to.equal("deployment-workflow.md")
			expect(result.globalWorkflows?.[0].contents).to.include("Deployment Workflow")
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
