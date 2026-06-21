import type { ApiProvider } from "@shared/api"
import type { RemoteConfigFields } from "@shared/storage/state-keys"
import { describe, expect, it } from "vitest"
import { getRemoteLockedProviderFieldPaths } from "./remote-config-locks"

describe("getRemoteLockedProviderFieldPaths", () => {
	it("locks LiteLLM API key writes when the key is remote configured", () => {
		const locked = getRemoteLockedProviderFieldPaths(
			{
				remoteConfiguredProviders: ["litellm"],
				configuredApiKeys: { litellm: true },
			},
			"litellm",
		)

		expect(locked).toEqual(new Set(["apiKey"]))
	})

	const cases: Array<{
		name: string
		remoteConfig: Partial<RemoteConfigFields>
		providerId: string
		expected: string[]
	}> = [
		{
			name: "OpenAI-compatible alias fields",
			remoteConfig: {
				remoteConfiguredProviders: ["openai-compatible" as ApiProvider],
				openAiBaseUrl: "https://remote.example/v1",
				openAiHeaders: { "x-remote": "locked" },
				azureApiVersion: "2026-01-01-preview",
			},
			providerId: "openai",
			expected: ["baseUrl", "headers", "azure.apiVersion"],
		},
		{
			name: "Bedrock nested AWS fields",
			remoteConfig: {
				remoteConfiguredProviders: ["bedrock"],
				awsRegion: "us-east-1",
				awsUseCrossRegionInference: true,
				awsUseGlobalInference: true,
				awsBedrockEndpoint: "https://bedrock.example",
			},
			providerId: "bedrock",
			expected: ["region", "aws.region", "aws.useCrossRegionInference", "aws.useGlobalInference", "aws.endpoint"],
		},
		{
			name: "Vertex project and region fields",
			remoteConfig: {
				remoteConfiguredProviders: ["vertex"],
				vertexProjectId: "remote-project",
				vertexRegion: "us-central1",
			},
			providerId: "vertex",
			expected: ["gcp.projectId", "region", "gcp.region"],
		},
	]

	it.each(cases)("locks $name", ({ remoteConfig, providerId, expected }) => {
		const locked = getRemoteLockedProviderFieldPaths(remoteConfig, providerId)

		expect(locked).toEqual(new Set(expected))
	})
})
