import {
	type ProviderSettingsManager,
	RuntimeOAuthTokenManager,
	resolveLocalClineAuthToken,
} from "@cline/core";

// Share the refresh-aware manager so token refreshes remain single-flight.
let clineOAuthTokenManager: RuntimeOAuthTokenManager | undefined;

export async function resolveFreshClineAuthToken(
	manager: ProviderSettingsManager,
): Promise<string | undefined> {
	try {
		clineOAuthTokenManager ??= new RuntimeOAuthTokenManager();
		const resolution = await clineOAuthTokenManager.resolveProviderApiKey({
			providerId: "cline",
		});
		if (resolution?.apiKey) {
			return resolution.apiKey;
		}
	} catch {
		// Let the request surface any persisted-token authentication failure.
	}
	return withProviderPrefix(
		resolveLocalClineAuthToken(manager.getProviderSettings("cline")),
	);
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
