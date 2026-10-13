import type { ApiConfiguration } from "@shared/api"
import { describe, expect, it } from "vitest"
import { buildBedrockProviderConfig, resolveBedrockAuthentication } from "./bedrock-config"

describe("resolveBedrockAuthentication", () => {
	it("maps the webview 'apikey' radio value straight through", () => {
		expect(resolveBedrockAuthentication({ awsAuthentication: "apikey" })).toBe("apikey")
	})

	it("maps the webview 'credentials' radio value to the SDK 'iam' spelling", () => {
		expect(resolveBedrockAuthentication({ awsAuthentication: "credentials" })).toBe("iam")
	})

	it("passes 'profile' through", () => {
		expect(resolveBedrockAuthentication({ awsAuthentication: "profile" })).toBe("profile")
	})

	it("defaults to 'profile' when an AWS profile is configured but no auth is set", () => {
		expect(resolveBedrockAuthentication({ awsProfile: "dev" })).toBe("profile")
		expect(resolveBedrockAuthentication({ awsUseProfile: true })).toBe("profile")
	})

	it("defaults to 'iam' (default credential chain) when nothing is set", () => {
		expect(resolveBedrockAuthentication({})).toBe("iam")
	})
})

describe("buildBedrockProviderConfig", () => {
	it("forwards the region and api-key authentication for a pasted Bedrock API key", () => {
		// Reproduces the reported bug: API key radio + pasted key. The key itself
		// is carried separately as the top-level ProviderConfig.apiKey; here we
		// assert the region + auth mode that were previously dropped.
		const config: ApiConfiguration = {
			awsAuthentication: "apikey",
			awsRegion: "us-east-1",
			awsBedrockApiKey: "bedrock-bearer-token",
		}

		const result = buildBedrockProviderConfig(config, "act")

		expect(result.region).toBe("us-east-1")
		expect(result.aws?.authentication).toBe("apikey")
		// No SigV4 credentials when authenticating with a bearer API key.
		expect(result.aws?.accessKey).toBeUndefined()
		expect(result.aws?.secretKey).toBeUndefined()
		expect(result.aws?.profile).toBeUndefined()
	})

	it("forwards static IAM credentials", () => {
		const config: ApiConfiguration = {
			awsAuthentication: "credentials",
			awsRegion: "us-west-2",
			awsAccessKey: "AKIA...",
			awsSecretKey: "secret",
			awsSessionToken: "token",
		}

		const result = buildBedrockProviderConfig(config, "act")

		expect(result.region).toBe("us-west-2")
		expect(result.aws?.authentication).toBe("iam")
		expect(result.aws?.accessKey).toBe("AKIA...")
		expect(result.aws?.secretKey).toBe("secret")
		expect(result.aws?.sessionToken).toBe("token")
	})

	it("forwards the profile only when authenticating via profile", () => {
		const profileResult = buildBedrockProviderConfig(
			{ awsAuthentication: "profile", awsProfile: "dev-profile", awsRegion: "us-east-2" },
			"act",
		)
		expect(profileResult.aws?.authentication).toBe("profile")
		expect(profileResult.aws?.profile).toBe("dev-profile")

		// A stale profile string must not leak through when auth is api-key.
		const apiKeyResult = buildBedrockProviderConfig(
			{ awsAuthentication: "apikey", awsProfile: "dev-profile", awsRegion: "us-east-2" },
			"act",
		)
		expect(apiKeyResult.aws?.authentication).toBe("apikey")
		expect(apiKeyResult.aws?.profile).toBeUndefined()
	})

	it("selects the mode-specific custom model base id", () => {
		const config: ApiConfiguration = {
			awsAuthentication: "apikey",
			awsRegion: "us-east-1",
			planModeAwsBedrockCustomModelBaseId: "plan-base",
			actModeAwsBedrockCustomModelBaseId: "act-base",
		}

		expect(buildBedrockProviderConfig(config, "plan").aws?.customModelBaseId).toBe("plan-base")
		expect(buildBedrockProviderConfig(config, "act").aws?.customModelBaseId).toBe("act-base")
	})

	it("does not carry prompt cache from plan mode into an act-mode Haiku base model", () => {
		const config: ApiConfiguration = {
			awsAuthentication: "apikey",
			awsBedrockUsePromptCache: true,
			planModeAwsBedrockCustomModelBaseId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
			actModeAwsBedrockCustomModelBaseId: "anthropic.claude-3-haiku-20240307-v1:0",
		}

		expect(buildBedrockProviderConfig(config, "plan").aws?.usePromptCache).toBe(true)
		expect(buildBedrockProviderConfig(config, "act").aws?.usePromptCache).toBe(false)
	})

	it("keeps Plan and Act prompt-cache settings independent", () => {
		const config: ApiConfiguration = {
			awsBedrockUsePromptCache: true,
			planModeAwsBedrockUsePromptCache: true,
			actModeAwsBedrockUsePromptCache: false,
			planModeAwsBedrockCustomModelBaseId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
			actModeAwsBedrockCustomModelBaseId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
		}

		expect(buildBedrockProviderConfig(config, "plan").aws?.usePromptCache).toBe(true)
		expect(buildBedrockProviderConfig(config, "act").aws?.usePromptCache).toBe(false)
	})

	it("falls back to the legacy shared prompt-cache setting after upgrade", () => {
		const config: ApiConfiguration = {
			awsBedrockUsePromptCache: true,
			planModeAwsBedrockCustomModelBaseId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
			actModeAwsBedrockCustomModelBaseId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
		}

		expect(buildBedrockProviderConfig(config, "plan").aws?.usePromptCache).toBe(true)
		expect(buildBedrockProviderConfig(config, "act").aws?.usePromptCache).toBe(true)
	})

	it("preserves prompt cache for non-Haiku or unknown Bedrock base models", () => {
		const sonnetConfig: ApiConfiguration = {
			awsBedrockUsePromptCache: true,
			actModeAwsBedrockCustomModelBaseId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
		}
		const unknownConfig: ApiConfiguration = {
			awsBedrockUsePromptCache: true,
			actModeAwsBedrockCustomModelBaseId: "custom.vendor-model",
		}

		expect(buildBedrockProviderConfig(sonnetConfig, "act").aws?.usePromptCache).toBe(true)
		expect(buildBedrockProviderConfig(unknownConfig, "act").aws?.usePromptCache).toBe(true)
	})
	it("forwards cross-region and global inference flags", () => {
		const result = buildBedrockProviderConfig(
			{
				awsAuthentication: "apikey",
				awsRegion: "us-east-1",
				awsUseCrossRegionInference: true,
				awsUseGlobalInference: true,
			},
			"act",
		)
		expect(result.useCrossRegionInference).toBe(true)
		expect(result.useGlobalInference).toBe(true)
	})

	it("trims whitespace-only region to undefined", () => {
		const result = buildBedrockProviderConfig({ awsAuthentication: "apikey", awsRegion: "   " }, "act")
		expect(result.region).toBeUndefined()
	})
})
