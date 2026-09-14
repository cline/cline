import { getProviderAuthHandler } from "../../auth/provider-auth-registry";
import {
	type ProviderSettings,
	ProviderSettingsSchemaTyped as ProviderSettingsSchema,
	type StoredProviderSettings,
} from "../../types/provider-settings";

/**
 * Resolve the settings a provider id denotes within a stored state, honoring
 * providers that keep their credentials under another provider's entry
 * (cline-pass stores under "cline").
 */
export function resolveStoredProviderSettings(
	state: StoredProviderSettings,
	providerId: string,
): ProviderSettings | undefined {
	const directSettings = state.providers[providerId]?.settings;
	const storageProviderId =
		getProviderAuthHandler(providerId)?.storageProviderId;
	if (!storageProviderId || storageProviderId === providerId) {
		return directSettings;
	}

	const authSettings = state.providers[storageProviderId]?.settings;
	if (!authSettings) {
		return directSettings;
	}

	return ProviderSettingsSchema.parse({
		...(authSettings.auth ? { auth: authSettings.auth } : {}),
		...(authSettings.apiKey ? { apiKey: authSettings.apiKey } : {}),
		...(authSettings.baseUrl ? { baseUrl: authSettings.baseUrl } : {}),
		...(directSettings ?? {}),
		provider: providerId,
	});
}

function hasResolvableSettings(
	state: StoredProviderSettings,
	providerId: string,
): boolean {
	try {
		return resolveStoredProviderSettings(state, providerId) !== undefined;
	} catch {
		return false;
	}
}

/**
 * The provider id `lastUsedProvider` effectively denotes: the stored id while
 * it still resolves to settings, otherwise the most recently saved provider
 * that does, and undefined only when nothing is configured.
 *
 * The stored id can outlive its entry — another Cline surface sharing
 * providers.json removed the provider, or a migration carried a stale pointer
 * forward. Every consumer treats an unresolvable last-used provider as "no
 * provider" and then defaults to the credentialed Cline provider, which turns
 * a stale pointer into a sign-in wall for a user whose real provider is
 * configured right next to it.
 */
export function resolveEffectiveLastUsedProviderId(
	state: StoredProviderSettings,
): string | undefined {
	const stored = state.lastUsedProvider;
	if (stored && hasResolvableSettings(state, stored)) {
		return stored;
	}

	let fallback: string | undefined;
	let fallbackUpdatedAt = Number.NEGATIVE_INFINITY;
	for (const [providerId, entry] of Object.entries(state.providers)) {
		if (!hasResolvableSettings(state, providerId)) {
			continue;
		}
		const parsed = Date.parse(entry.updatedAt);
		const updatedAt = Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
		// Strictly newer only, so equal timestamps keep insertion order.
		if (fallback === undefined || updatedAt > fallbackUpdatedAt) {
			fallback = providerId;
			fallbackUpdatedAt = updatedAt;
		}
	}
	return fallback;
}

/**
 * Return `state` with `lastUsedProvider` set to its effective value. The same
 * object is returned when nothing changes, so callers can detect a repair.
 */
export function normalizeLastUsedProvider(
	state: StoredProviderSettings,
): StoredProviderSettings {
	const effective = resolveEffectiveLastUsedProviderId(state);
	if (effective === state.lastUsedProvider) {
		return state;
	}
	const next: StoredProviderSettings = { ...state };
	if (effective === undefined) {
		delete next.lastUsedProvider;
	} else {
		next.lastUsedProvider = effective;
	}
	return next;
}
