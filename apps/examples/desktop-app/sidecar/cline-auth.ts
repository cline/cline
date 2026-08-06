import {
	type ProviderSettingsManager,
	RuntimeOAuthTokenManager,
	resolveLocalClineAuthToken,
} from "@cline/core";

// Cline access tokens expire between app launches, so every account request
// must resolve through the refresh-aware OAuth manager instead of capturing a
// persisted token once. The refresh token is single-use; sharing one manager
// also keeps concurrent refreshes single-flight.
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
		// Fall back to the persisted token; the request itself will surface an
		// authentication failure with the operation's normal error handling.
	}
	return withProviderPrefix(
		resolveLocalClineAuthToken(manager.getProviderSettings("cline")),
	);
}

// core-platform only accepts prefixed bearer tokens (`workos:<jwt>`, `sk_…`,
// `cline:<key>`); a bare token is rejected with a misleading "no longer
// supported" error. Stored OAuth access tokens are persisted unprefixed, so
// the fallback path must restore the prefix the OAuth manager would add.
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
