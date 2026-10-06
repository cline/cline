import { getProviderAuthHandler } from "../../auth/provider-auth-registry";
import {
	type ProviderSettings,
	ProviderSettingsSchemaTyped as ProviderSettingsSchema,
	type StoredProviderSettings,
} from "../../types/provider-settings";
import { toProviderConfig } from "../llms/provider-settings";
import { isProviderSettingsUsable } from "../providers/provider-readiness";

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
 * Whether a provider can stand in for a dangling pointer: not merely present,
 * but holding credentials or a resolvable endpoint. A settings entry alone
 * proves little — migrations and empty "connect" saves create entries that
 * cannot serve a turn, such as a phantom `sapaicore` with no credentials.
 *
 * Readiness is judged against the resolved provider config, as the other
 * readiness callers do, so a provider relying on its default endpoint (LM
 * Studio with no stored baseUrl) counts as usable.
 */
function isUsableFallback(
	state: StoredProviderSettings,
	providerId: string,
): boolean {
	try {
		const settings = resolveStoredProviderSettings(state, providerId);
		if (!settings) {
			return false;
		}
		return isProviderSettingsUsable(
			providerId,
			settings,
			toProviderConfig(settings, { includeKnownModels: false }),
		);
	} catch {
		return false;
	}
}

/**
 * The most recently saved provider that is usable, or undefined when none is.
 */
export function findUsableFallbackProviderId(
	state: StoredProviderSettings,
): string | undefined {
	let fallback: string | undefined;
	let fallbackUpdatedAt = Number.NEGATIVE_INFINITY;
	for (const [providerId, entry] of Object.entries(state.providers)) {
		if (!isUsableFallback(state, providerId)) {
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
 * The provider id `lastUsedProvider` effectively denotes. A stored id that
 * still resolves to settings is kept — including a signed-out `cline` entry,
 * which keeps its sign-in flow. A dangling id (one with no settings) is
 * replaced by the most recently saved usable provider. An absent pointer stays
 * absent: removing or disabling the selected provider deliberately clears the
 * selection.
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
	if (!stored) {
		return undefined;
	}
	if (hasResolvableSettings(state, stored)) {
		return stored;
	}
	return findUsableFallbackProviderId(state);
}

/**
 * The pointer to carry across a save that does not claim the last-used slot.
 * The stored id survives when it resolves once this save is applied — signing
 * in to Cline creates the `cline` entry a dangling `cline` / `cline-pass`
 * pointer was waiting for, and that selection should come back. Otherwise the
 * pointer is repaired from the state before the save, so an unrelated save
 * cannot become the fallback just by being the newest entry. When the state
 * before the save has nothing usable, the dangling pointer is carried as-is
 * and write() repairs it against the saved state.
 */
export function carryLastUsedProvider(
	previous: StoredProviderSettings,
	next: StoredProviderSettings,
): string | undefined {
	const stored = previous.lastUsedProvider;
	if (stored && hasResolvableSettings(next, stored)) {
		return stored;
	}
	return resolveEffectiveLastUsedProviderId(previous) ?? stored;
}

/**
 * Return `state` with a dangling `lastUsedProvider` replaced by its usable
 * stand-in. A dangling pointer with no stand-in is kept: dropping it would
 * erase the only record that a repair is still owed, and an absent pointer is
 * never repaired. The same object is returned when nothing changes.
 */
export function normalizeLastUsedProvider(
	state: StoredProviderSettings,
): StoredProviderSettings {
	const effective = resolveEffectiveLastUsedProviderId(state);
	if (effective === undefined || effective === state.lastUsedProvider) {
		return state;
	}
	return { ...state, lastUsedProvider: effective };
}
