import { describe, expect, it } from "vitest"
import { transformRemoteConfigToStateShape } from "../utils"

describe("transformRemoteConfigToStateShape", () => {
	it("preserves remote provider model allowlists and Bedrock custom models", () => {
		const transformed = transformRemoteConfigToStateShape({
			version: "v1",
			providerSettings: {
				OpenAiCompatible: {
					models: [{ id: "openai-compatible-model", contextWindow: 128_000 }],
				},
				AwsBedrock: {
					models: [{ id: "anthropic.claude-sonnet-4-6", thinkingBudgetTokens: 4096 }],
					customModels: [
						{
							name: "application-inference-profile",
							baseModelId: "anthropic.claude-sonnet-4-6",
							thinkingBudgetTokens: 2048,
						},
					],
				},
				Vertex: {
					models: [{ id: "claude-sonnet-4@20250514", thinkingBudgetTokens: 1024 }],
				},
			},
		})

		expect(transformed.remoteProviderModelSettings).toEqual({
			"openai-compatible": {
				models: [{ id: "openai-compatible-model", contextWindow: 128_000 }],
			},
			bedrock: {
				models: [{ id: "anthropic.claude-sonnet-4-6", thinkingBudgetTokens: 4096 }],
				bedrockCustomModels: [
					{
						name: "application-inference-profile",
						baseModelId: "anthropic.claude-sonnet-4-6",
						thinkingBudgetTokens: 2048,
					},
				],
			},
			vertex: {
				models: [{ id: "claude-sonnet-4@20250514", thinkingBudgetTokens: 1024 }],
			},
		})
	})
})
