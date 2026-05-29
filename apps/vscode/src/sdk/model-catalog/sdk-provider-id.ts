import type { ProviderId } from "./contracts"

/**
 * Convert the extension's provider id spelling to the SDK's provider id
 * spelling. Extension config/storage intentionally keeps provider ids
 * lowercased for cross-version portability; the SDK registry has a few
 * case-sensitive ids.
 */
const EXTENSION_TO_SDK_PROVIDER_ID: Readonly<Record<string, string>> = {
	nousresearch: "nousResearch",
}

export function toSdkProviderId(providerId: ProviderId | string): string {
	return EXTENSION_TO_SDK_PROVIDER_ID[providerId.toString()] ?? providerId.toString()
}
