import {
	captureAuthRefreshSoftFailure,
	getProviderAuthHandler,
	type ProviderSettingsManager,
	RuntimeOAuthTokenManager,
} from "@cline/core";
import type { SidecarContext } from "./types";

// Share the refresh-aware manager so single-use refresh tokens stay single-flight.
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
		// A persisted token may still let the account request surface the failure.
		refreshError = error instanceof Error ? error : new Error(String(error));
	}
	// Apply canonical OAuth-token formatting while preserving raw API keys.
	const persisted = getProviderAuthHandler("cline")?.getApiKey(
		manager.getProviderSettings("cline"),
	);
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
