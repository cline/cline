import type { ApiProvider } from "@shared/api"

const SDK_PROVIDER_ID_TO_LEGACY_API_PROVIDER: Partial<Record<string, ApiProvider>> = {
	// parseProviderId lowercases provider ids at the SDK catalog boundary, but
	// legacy ApiConfiguration keys still use the camel-cased ApiProvider literal.
	// Keep casing fixes centralized here instead of spreading inline shims across
	// controller handlers and storage adapters.
	nousresearch: "nousResearch",
} satisfies Partial<Record<string, ApiProvider>>

export const MIGRATED_SDK_PROVIDER_IDS = new Set<string>(["cline", "deepseek"])

export function isMigratedSdkProvider(providerId: string | undefined): boolean {
	return Boolean(providerId && MIGRATED_SDK_PROVIDER_IDS.has(providerId))
}

export function toLegacyApiProvider(providerId: string): ApiProvider {
	return SDK_PROVIDER_ID_TO_LEGACY_API_PROVIDER[providerId] ?? (providerId as ApiProvider)
}
