import type { ApiProvider } from "@shared/api"

/**
 * SDK-side provider ids are lower-cased by `parseProviderId` at the
 * catalog boundary, but the legacy `ApiConfiguration` keys still use
 * the camel-cased `ApiProvider` literal in a couple of places (notably
 * `nousResearch`). Keep the casing fixes centralized here instead of
 * spreading inline shims across controller handlers and storage
 * adapters.
 */
const SDK_PROVIDER_ID_TO_LEGACY_API_PROVIDER: Partial<Record<string, ApiProvider>> = {
	nousresearch: "nousResearch",
} satisfies Partial<Record<string, ApiProvider>>

export function toLegacyApiProvider(providerId: string): ApiProvider {
	return SDK_PROVIDER_ID_TO_LEGACY_API_PROVIDER[providerId] ?? (providerId as ApiProvider)
}
