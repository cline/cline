import {
	getProviderAuthStorageId,
	type ProviderSettingsManager,
	saveLocalProviderSettings,
} from "@cline/core";
import { CLI_PROMO_CODE } from "../../../utils/cline-pass-errors";

const CLINE_PASS_SUBSCRIPTION_PATH = "/dashboard/subscription";
const DEFAULT_APP_BASE_URL = "https://app.cline.bot";

/**
 * Persist a manually entered API key for an OAuth-capable provider — the
 * escape hatch for when OAuth login isn't working. Any stored OAuth tokens
 * are cleared: the auth handler prefers auth.accessToken over apiKey, so a
 * stale token would otherwise keep winning over the manual key.
 *
 * The key is written both to the provider's auth storage entry (cline-pass
 * stores credentials under "cline") and to the provider's own entry: settings
 * resolution lets a direct entry shadow the storage entry, and provider
 * switching copies merged settings (including auth) into direct entries, so
 * both must be updated for the manual key to reliably take effect.
 */
export function saveManualProviderApiKey(
	manager: ProviderSettingsManager,
	providerId: string,
	apiKey: string,
): void {
	// Empty strings delete these keys from the stored auth object.
	const clearedAuth = { accessToken: "", refreshToken: "", apiKey: "" };
	const storageProviderId = getProviderAuthStorageId(providerId) ?? providerId;
	saveLocalProviderSettings(manager, {
		providerId: storageProviderId,
		apiKey,
		auth: clearedAuth,
	});
	if (
		providerId !== storageProviderId &&
		manager.read().providers[providerId]
	) {
		saveLocalProviderSettings(manager, {
			providerId,
			apiKey,
			auth: clearedAuth,
		});
	}
}

export function buildClinePassSubscriptionPageUrl(
	appBaseUrl: string | undefined,
): string {
	const url = new URL(
		CLINE_PASS_SUBSCRIPTION_PATH,
		appBaseUrl || DEFAULT_APP_BASE_URL,
	);
	url.searchParams.set("personal", "true");
	url.searchParams.set("code", CLI_PROMO_CODE);
	return url.toString();
}
