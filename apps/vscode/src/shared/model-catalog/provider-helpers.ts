import type { ApiProvider } from "@shared/api"

/**
 * Convert SDK/catalog provider ids to the legacy `ApiProvider` spelling used
 * by `ApiConfiguration` keys. Most ids are identical; this helper remains as
 * the central boundary for any future spelling aliases.
 */
const SDK_PROVIDER_ID_TO_LEGACY_API_PROVIDER: Partial<Record<string, ApiProvider>> = {
	nousResearch: "nousResearch",
	nousresearch: "nousResearch",
} satisfies Partial<Record<string, ApiProvider>>

export function toLegacyApiProvider(providerId: string): ApiProvider {
	return SDK_PROVIDER_ID_TO_LEGACY_API_PROVIDER[providerId] ?? (providerId as ApiProvider)
}
