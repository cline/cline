import {
	type BasicLogger,
	captureAuthRefreshSoftFailure,
	type ITelemetryService,
	type ProviderSettingsManager,
	RuntimeOAuthTokenManager,
	resolveLocalClineAuthToken,
} from "@cline/core";

// Share the refresh-aware manager so token refreshes remain single-flight.
let clineOAuthTokenManager: RuntimeOAuthTokenManager | undefined;

export async function resolveFreshClineAuthToken(
	manager: ProviderSettingsManager,
	options: {
		prefixPersistedToken?: boolean;
		logger?: BasicLogger;
		telemetry?: ITelemetryService;
	} = {},
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
		refreshError = error instanceof Error ? error : new Error(String(error));
	}
	const persisted = resolveLocalClineAuthToken(
		manager.getProviderSettings("cline"),
	);
	if (!persisted && refreshError) {
		options.logger?.error?.(
			"Cline auth token refresh failed with no fallback",
			{
				error: refreshError,
			},
		);
		captureAuthRefreshSoftFailure(options.telemetry, "cline", {
			errorName: refreshError.name,
			errorCode: "desktop_refresh_failed_no_fallback_token",
		});
	}
	return options.prefixPersistedToken === false
		? persisted
		: withProviderPrefix(persisted);
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
