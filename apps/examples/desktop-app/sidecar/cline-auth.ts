import {
	captureAuthRefreshSoftFailure,
	getProviderAuthHandler,
	type ProviderSettingsManager,
	RuntimeOAuthTokenManager,
} from "@cline/core";
import type { SidecarContext } from "./types";

// Cline access tokens expire between app launches, so account requests must
// resolve through the refresh-aware OAuth manager instead of reading the
// persisted token directly. A single shared instance keeps concurrent account
// requests single-flight; the refresh token is single-use, so parallel
// refreshes would invalidate each other.
let clineOAuthTokenManager: RuntimeOAuthTokenManager | undefined;

export async function resolveFreshClineAuthToken(
	manager: ProviderSettingsManager,
	ctx?: SidecarContext,
): Promise<string | undefined> {
	let refreshError: Error | undefined;
	try {
		clineOAuthTokenManager ??= new RuntimeOAuthTokenManager();
		const resolution = await clineOAuthTokenManager.resolveProviderApiKey({
			providerId: "cline",
		});
		if (resolution?.apiKey) {
			return resolution.apiKey;
		}
	} catch (error) {
		// Fall back to the persisted token; when one exists the account request
		// surfaces the auth failure to the caller.
		refreshError = error instanceof Error ? error : new Error(String(error));
	}
	// The canonical handler applies the same formatting the refresh path uses:
	// OAuth access tokens gain the `workos:` prefix core-platform expects,
	// while raw API keys pass through untouched.
	const persisted = getProviderAuthHandler("cline")?.getApiKey(
		manager.getProviderSettings("cline"),
	);
	// Never-signed-in resolves to undefined without a refresh attempt and is
	// silent. A refresh failure with no persisted fallback means credentials
	// existed but yielded nothing — that is the signal a real auth regression
	// would show up as, so report exactly one event for it.
	if (!persisted && refreshError && ctx) {
		ctx.logger?.error?.("Cline auth token refresh failed with no fallback", {
			error: refreshError,
		});
		captureAuthRefreshSoftFailure(ctx.telemetry, "cline", {
			errorName: refreshError.name,
			errorCode: "desktop_refresh_failed_no_fallback_token",
		});
	}
	return persisted;
}
