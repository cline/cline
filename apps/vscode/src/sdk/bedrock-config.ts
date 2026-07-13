// Maps the extension's legacy Bedrock ApiConfiguration onto the SDK's
// structured AWS provider options (region + aws block).
//
// Both inference paths need this:
//   - buildSdkProviderConfig() in sdk-api-handler.ts (standalone utility calls)
//   - buildSessionConfig() in cline-session-factory.ts (main task loop, which
//     hands a CoreSessionConfig.providerConfig to ClineCore)
//
// Without it, the SDK gateway never receives the AWS region or authentication
// mode, so a pasted Bedrock API key (awsBedrockApiKey + awsAuthentication
// "apikey") is silently ignored and requests fall through to the SigV4
// credential chain with no region. This mirrors the structured aws block built
// by the shared provider-settings legacy migration and the CLI.

import type { ProviderSettings } from "@cline/core"
import type { ProviderConfig } from "@cline/llms"
import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"

type AwsConfig = NonNullable<ProviderConfig["aws"]>
type AwsAuthentication = NonNullable<AwsConfig["authentication"]>

/** The Bedrock-specific subset of an SDK ProviderConfig. */
export type BedrockProviderConfig = Pick<ProviderConfig, "region" | "aws" | "useCrossRegionInference" | "useGlobalInference">

function trimToUndefined(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined
	}
	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : undefined
}

function selectedBedrockBaseModelId(configuration: ApiConfiguration, mode: Mode): string | undefined {
	return trimToUndefined(
		mode === "plan" ? configuration.planModeAwsBedrockCustomModelBaseId : configuration.actModeAwsBedrockCustomModelBaseId,
	)
}

function shouldUseBedrockPromptCache(configuration: ApiConfiguration, mode: Mode): boolean | undefined {
	if (configuration.awsBedrockUsePromptCache !== true) {
		return configuration.awsBedrockUsePromptCache
	}

	const baseModelId = selectedBedrockBaseModelId(configuration, mode)?.toLowerCase()
	if (baseModelId?.includes("claude") && baseModelId.includes("haiku")) {
		return false
	}

	return true
}

/**
 * Map the webview's `awsAuthentication` radio value onto the SDK's
 * `AwsConfig.authentication` spelling.
 *
 * The Bedrock settings UI stores `"apikey"`, `"profile"`, or `"credentials"`.
 * The SDK understands `"apikey"`/`"api-key"`, `"profile"`, and `"iam"`. The
 * webview's `"credentials"` option means "use the default AWS credential
 * chain", which is `"iam"` in SDK terms. When unset, fall back to the same
 * heuristic the UI uses for its default radio selection (profile when an AWS
 * profile is configured, otherwise the default credential chain).
 */
export function resolveBedrockAuthentication(configuration: ApiConfiguration): AwsAuthentication {
	const explicit = configuration.awsAuthentication
	if (explicit === "apikey" || explicit === "api-key" || explicit === "profile" || explicit === "iam") {
		return explicit
	}
	if (explicit === "credentials") {
		return "iam"
	}
	// No explicit selection: mirror the webview's default radio resolution.
	if (configuration.awsUseProfile || trimToUndefined(configuration.awsProfile)) {
		return "profile"
	}
	return "iam"
}

/**
 * Build the Bedrock `region` + `aws` portion of the SDK ProviderConfig from the
 * extension's ApiConfiguration for the given mode (plan/act).
 */
export function buildBedrockProviderConfig(configuration: ApiConfiguration, mode: Mode): BedrockProviderConfig {
	const authentication = resolveBedrockAuthentication(configuration)
	const usesProfile = authentication === "profile"
	const aws: AwsConfig = {
		accessKey: trimToUndefined(configuration.awsAccessKey),
		secretKey: trimToUndefined(configuration.awsSecretKey),
		sessionToken: trimToUndefined(configuration.awsSessionToken),
		authentication,
		profile: usesProfile ? trimToUndefined(configuration.awsProfile) : undefined,
		usePromptCache: shouldUseBedrockPromptCache(configuration, mode),
		endpoint: trimToUndefined(configuration.awsBedrockEndpoint),
		customModelBaseId: selectedBedrockBaseModelId(configuration, mode),
	}
	return {
		region: trimToUndefined(configuration.awsRegion),
		aws,
		useCrossRegionInference: configuration.awsUseCrossRegionInference,
		useGlobalInference: configuration.awsUseGlobalInference,
	}
}

/**
 * Build the full SDK `ProviderSettings` for Bedrock from the extension's
 * ApiConfiguration, suitable for persisting to providers.json via
 * `ProviderSettingsManager.saveProviderSettings`.
 *
 * WHY THIS EXISTS (the second Bedrock bug):
 * The main chat path runs through core's `buildProviderConfig`
 * (local-runtime-bootstrap.ts), which builds the gateway-registered
 * ProviderSettings as `{ ...stored, provider, model, apiKey, baseUrl, ... }`.
 * The `aws` block and `region` come ONLY from `stored` (providers.json) — the
 * session's `providerConfig` is consulted by a different code path and does NOT
 * override the gateway registration. So a stale providers.json Bedrock entry
 * (e.g. a legacy migration with region "us-east-1" + SigV4 keys) silently wins:
 * requests go to the wrong region and 403, even though StateManager has the
 * correct region + apikey auth.
 *
 * Writing the StateManager-derived settings back to providers.json makes
 * `stored` authoritative and correct, so the gateway is configured with the
 * region/auth the user actually selected.
 */
export function buildBedrockProviderSettings(configuration: ApiConfiguration, modelId: string, mode: Mode): ProviderSettings {
	const { region, aws, useCrossRegionInference, useGlobalInference } = buildBedrockProviderConfig(configuration, mode)
	// Only persist the bearer apiKey when actually authenticating with api-key.
	// Otherwise (profile/iam) a stale key could linger in providers.json; the SDK
	// ignores it for SigV4 auth, but we keep `stored` clean and unambiguous.
	const usesApiKeyAuth = aws?.authentication === "apikey" || aws?.authentication === "api-key"
	const apiKey = usesApiKeyAuth ? trimToUndefined(configuration.awsBedrockApiKey) : undefined
	return {
		provider: "bedrock",
		model: modelId,
		...(apiKey ? { apiKey } : {}),
		...(region ? { region } : {}),
		aws: {
			...aws,
			...(region ? { region } : {}),
			...(useCrossRegionInference !== undefined ? { useCrossRegionInference } : {}),
			...(useGlobalInference !== undefined ? { useGlobalInference } : {}),
		},
	}
}
