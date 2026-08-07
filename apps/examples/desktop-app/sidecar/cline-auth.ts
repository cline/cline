import {
	type ProviderSettingsManager,
	RuntimeOAuthTokenManager,
	captureAuthRefreshSoftFailure,
	resolveLocalClineAuthToken,
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
	const persisted = withProviderPrefix(
		resolveLocalClineAuthToken(manager.getProviderSettings("cline")),
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

// Persisted OAuth tokens omit the `workos:` prefix required by core-platform.
function withProviderPrefix(token: string | undefined): string | undefined {
	const trimmed = token?.trim();
	if (!trimmed) {
		return undefined;
	}
	if (trimmed.startsWith("sk_") || trimmed.includes(":")) {
		return trimmed;
	}
	return `workos:${trimmed}`;
}

/** Test-only reset so auth tests do not leak a cached OAuth manager. */
export function resetFreshClineAuthTokenManagerForTests(): void {
	clineOAuthTokenManager = undefined;
}
