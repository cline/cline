import {
	formatProviderOAuthApiKey,
	getPersistedProviderApiKey as getCorePersistedProviderApiKey,
	isOAuthProvider,
	Llms,
	type ProviderOAuthCredentials,
	type ProviderSettings,
} from "@cline/core";

export type OAuthCredentials = ProviderOAuthCredentials;

export function normalizeProviderId(providerId: string): string {
	return Llms.normalizeProviderId(providerId.trim());
}

export function normalizeAuthProviderId(providerId: string): string {
	const normalized = providerId.trim().toLowerCase();
	if (normalized === "codex" || normalized === "openai-codex") {
		return "openai-codex";
	}
	return normalizeProviderId(normalized);
}

export { isOAuthProvider };

/**
 * Returns true when the provider declares API key environment variables and
 * one of them is set. Runtime request paths resolve these env keys even when
 * no settings are persisted, so they count as usable credentials (e.g. for
 * agent profiles that pin a provider the user only configured via env).
 */
export function hasEnvProviderApiKey(providerId: string): boolean {
	const envKeys = Llms.getProviderCollectionSync(providerId)?.provider.env;
	return (envKeys ?? []).some((key) => !!process.env[key]?.trim());
}

export function toProviderApiKey(
	providerId: string,
	credentials: Pick<OAuthCredentials, "access">,
): string {
	return formatProviderOAuthApiKey(providerId, credentials);
}

export function getPersistedProviderApiKey(
	providerId: string,
	settings?: ProviderSettings,
): string | undefined {
	return getCorePersistedProviderApiKey(providerId, settings);
}

/**
 * Returns true when the user has previously saved any meaningful credentials
 * or endpoint config for the provider. Used by the picker to decide whether
 * to offer "Use existing configuration?" before opening the configure dialog.
 *
 * Treats OAuth providers as configured when an access token is present; for
 * everything else, any persisted API key, base URL, or model id counts. We
 * don't enforce required fields here — the runtime no longer pre-flights
 * credentials, so a missing key only matters when the API call actually
 * runs and the provider's own auth error is surfaced.
 */
export function isProviderConfigured(
	providerId: string,
	settings: ProviderSettings | undefined,
): boolean {
	if (!settings) return false;
	if (isOAuthProvider(providerId)) {
		return Boolean(settings.auth?.accessToken?.trim());
	}
	if (getPersistedProviderApiKey(providerId, settings)) return true;
	if (settings.baseUrl?.trim()) return true;
	if (settings.model?.trim()) return true;
	return false;
}

export async function ensureOAuthProviderApiKey(
	input: Parameters<
		typeof import("../commands/auth").ensureOAuthProviderApiKey
	>[0],
): Promise<
	Awaited<
		ReturnType<typeof import("../commands/auth").ensureOAuthProviderApiKey>
	>
> {
	const { ensureOAuthProviderApiKey: ensureFromCommand } = await import(
		"../commands/auth"
	);
	return await ensureFromCommand(input);
}
