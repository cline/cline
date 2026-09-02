import {
	captureAuthRefreshSoftFailure,
	ProviderSettingsManager,
	RuntimeOAuthTokenManager,
	resolveLocalClineAuthToken,
} from "@cline/core";
import type { BasicLogger, ITelemetryService } from "@cline/shared";
import { getClineEnvironmentConfig } from "@cline/shared";

/**
 * Shared Cline-account auth for the sidecar: one refresh-aware OAuth manager
 * for every caller (account requests, integrations, the connectors proxy).
 * The refresh token is single-use, so this singleton is load-bearing — two
 * managers racing a refresh would invalidate each other's tokens.
 */
let clineOAuthTokenManager: RuntimeOAuthTokenManager | undefined;

export type ClineAuthTelemetryContext = {
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
};

/**
 * Cline access tokens expire between app launches, so callers must resolve
 * through the refresh-aware manager instead of reading the persisted token
 * directly; the persisted token is only the fallback when a refresh fails.
 */
export async function resolveFreshClineAuthToken(
	ctx: ClineAuthTelemetryContext,
	manager: ProviderSettingsManager,
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
	const persisted = resolveLocalClineAuthToken(
		manager.getProviderSettings("cline"),
	);
	// Never-signed-in resolves to undefined without a refresh attempt and is
	// silent. A refresh failure with no persisted fallback means credentials
	// existed but yielded nothing — that is the signal a real auth regression
	// would show up as, so report exactly one event for it.
	if (!persisted && refreshError) {
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

/**
 * The signed-in Cline account id, or undefined when signed out. Synchronous
 * (persisted provider settings), so identity checks can run inside the
 * no-await state-mutation windows the connector lifecycle relies on.
 */
export function getClineAccountId(): string | undefined {
	const accountId = new ProviderSettingsManager()
		.getProviderSettings("cline")
		?.auth?.accountId?.trim();
	return accountId || undefined;
}

/** Base URL of the Cline API (https://api.cline.bot in production), honoring
 * a per-provider baseUrl override and the environment config. */
export function getClineApiBaseUrl(): string {
	const override = new ProviderSettingsManager()
		.getProviderSettings("cline")
		?.baseUrl?.trim();
	return (override || getClineEnvironmentConfig().apiBaseUrl).replace(
		/\/+$/,
		"",
	);
}

export type ConnectorsApiAuth = {
	baseUrl: string;
	token: string;
};

/**
 * Auth for the Cline API connectors proxy: the account bearer token plus the
 * API base URL. Undefined when signed out (or when a refresh fails with no
 * persisted fallback) — connector calls then fail closed.
 */
export async function resolveConnectorsApiAuth(
	ctx: ClineAuthTelemetryContext = {},
): Promise<ConnectorsApiAuth | undefined> {
	const token = await resolveFreshClineAuthToken(
		ctx,
		new ProviderSettingsManager(),
	);
	if (!token) {
		return undefined;
	}
	return { baseUrl: getClineApiBaseUrl(), token };
}
