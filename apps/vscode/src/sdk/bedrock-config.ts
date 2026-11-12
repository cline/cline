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
import { StateManager } from "@/core/storage/StateManager"
import { getProviderSettingsManager } from "./provider-migration"

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

function readStateOverlays(): Partial<ApiConfiguration> {
	try {
		return StateManager.get().getApiConfigurationOverlays?.() ?? {}
	} catch {
		return {}
	}
}

function readBedrockProviderSettings(): ProviderSettings | undefined {
	try {
		return getProviderSettingsManager().getProviderSettings("bedrock")
	} catch {
		return undefined
	}
}

function normalizeExplicitAuthentication(value: unknown): AwsAuthentication | undefined {
	if (value === "apikey" || value === "api-key" || value === "profile" || value === "iam") {
		return value
	}
	if (value === "credentials") {
		return "iam"
	}
	return undefined
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
export function resolveBedrockAuthentication(
	configuration: ApiConfiguration,
	storedAws?: ProviderSettings["aws"],
): AwsAuthentication {
	const explicit =
		normalizeExplicitAuthentication(storedAws?.authentication) ??
		normalizeExplicitAuthentication(configuration.awsAuthentication)
	if (explicit) {
		return explicit
	}
	// No explicit selection: mirror the webview's default radio resolution.
	if (configuration.awsUseProfile || trimToUndefined(storedAws?.profile) || trimToUndefined(configuration.awsProfile)) {
		return "profile"
	}
	return "iam"
}

/**
 * Build the Bedrock `region` + `aws` portion of the SDK ProviderConfig from
 * active StateManager overlays, `providers.json`, and the extension's legacy
 * ApiConfiguration for the given mode (plan/act).
 */
export function buildBedrockProviderConfig(configuration: ApiConfiguration, mode: Mode): BedrockProviderConfig {
	const overlays = readStateOverlays()
	const stored = readBedrockProviderSettings()
	const storedAws = stored?.aws
	const authentication = resolveBedrockAuthentication(configuration, storedAws)
	const usesProfile = authentication === "profile"
	const legacyCustomModelBaseId = trimToUndefined(
		mode === "plan" ? configuration.planModeAwsBedrockCustomModelBaseId : configuration.actModeAwsBedrockCustomModelBaseId,
	)
	const aws: AwsConfig = {
		accessKey: trimToUndefined(storedAws?.accessKey) ?? trimToUndefined(configuration.awsAccessKey),
		secretKey: trimToUndefined(storedAws?.secretKey) ?? trimToUndefined(configuration.awsSecretKey),
		sessionToken: trimToUndefined(storedAws?.sessionToken) ?? trimToUndefined(configuration.awsSessionToken),
		authentication,
		profile: usesProfile ? (trimToUndefined(storedAws?.profile) ?? trimToUndefined(configuration.awsProfile)) : undefined,
		usePromptCache: overlays.awsBedrockUsePromptCache ?? storedAws?.usePromptCache ?? configuration.awsBedrockUsePromptCache,
		endpoint:
			trimToUndefined(overlays.awsBedrockEndpoint) ??
			trimToUndefined(storedAws?.endpoint) ??
			trimToUndefined(configuration.awsBedrockEndpoint),
		customModelBaseId: trimToUndefined(storedAws?.customModelBaseId) ?? legacyCustomModelBaseId,
	}
	return {
		region:
			trimToUndefined(overlays.awsRegion) ?? trimToUndefined(stored?.region) ?? trimToUndefined(configuration.awsRegion),
		aws,
		useCrossRegionInference:
			overlays.awsUseCrossRegionInference ?? storedAws?.useCrossRegionInference ?? configuration.awsUseCrossRegionInference,
		useGlobalInference:
			overlays.awsUseGlobalInference ?? storedAws?.useGlobalInference ?? configuration.awsUseGlobalInference,
	}
}
