import type { ApiProvider } from "@shared/api"

export const VSCODE_DEFAULT_PROVIDER_ID: ApiProvider = "cline"
const VSCODE_UNSUPPORTED_PROVIDER_IDS = new Set(["claude-code", "qwen-code", "dify"])

/**
 * Convert SDK/catalog provider ids to the legacy `ApiProvider` spelling used
 * by `ApiConfiguration` keys. Most ids are identical; this helper remains as
 * the central boundary for any future spelling aliases.
 */
const SDK_PROVIDER_ID_TO_LEGACY_API_PROVIDER: Partial<Record<string, ApiProvider>> = {
	nousResearch: "nousResearch",
	nousresearch: "nousResearch",
	"openai-compatible": "openai",
} satisfies Partial<Record<string, ApiProvider>>

export function toLegacyApiProvider(providerId: string): ApiProvider {
	return SDK_PROVIDER_ID_TO_LEGACY_API_PROVIDER[providerId] ?? (providerId as ApiProvider)
}

export function isVscodeUnsupportedProvider(providerId: string | undefined): boolean {
	return providerId ? VSCODE_UNSUPPORTED_PROVIDER_IDS.has(providerId) : false
}

export function toVscodeSupportedProvider(
	providerId: string | undefined,
	fallback: ApiProvider = VSCODE_DEFAULT_PROVIDER_ID,
): ApiProvider {
	if (!providerId || isVscodeUnsupportedProvider(providerId)) {
		return fallback
	}
	return toLegacyApiProvider(providerId)
}

export function areProviderIdsEquivalent(left: string | undefined, right: string | undefined): boolean {
	if (!left || !right) {
		return false
	}

	return left === right || toLegacyApiProvider(left) === toLegacyApiProvider(right)
}

export function isProviderAllowedByRemoteConfig(
	provider: string | undefined,
	remoteConfiguredProviders: readonly string[],
): boolean {
	if (!provider) {
		return false
	}

	return remoteConfiguredProviders.some((configuredProvider) => areProviderIdsEquivalent(provider, configuredProvider))
}
