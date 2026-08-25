import type { Provider } from "@/lib/provider-schema";

/**
 * Providers whose credentials are managed through an OAuth sign-in flow
 * rather than a pasted API key. Mirrors the SDK's provider auth registry
 * (see sdk/packages/core/src/auth/provider-auth-registry.ts); the catalog's
 * "oauth" capability is the primary signal and this set is the fallback for
 * entries whose capability metadata is incomplete.
 */
export const OAUTH_PROVIDER_IDS = new Set([
	"cline",
	// ClinePass shares the Cline account OAuth credentials (its auth handler
	// stores under the "cline" provider), so it never has its own API key.
	"cline-pass",
	"oca",
	"openai-codex",
]);

export type ProviderAuthKind = "oauth" | "local" | "api-key";

/**
 * How a provider expects to be authenticated, which drives which connect UI
 * to show: a browser sign-in button (oauth), a "uses your local CLI" notice
 * (local), or credential fields (api-key).
 */
export function getProviderAuthKind(provider: Provider): ProviderAuthKind {
	if (
		provider.capabilities?.includes("oauth") ||
		OAUTH_PROVIDER_IDS.has(provider.id)
	) {
		return "oauth";
	}
	if (provider.capabilities?.includes("local-auth")) {
		return "local";
	}
	return "api-key";
}

/**
 * Whether a provider from the catalog is usable for turns, for the purpose
 * of the first-run "connect a model" notice. Plain API keys and OAuth are
 * definitive. Beyond those, an enabled provider counts as connected unless
 * a *required* config field is unmet: `enabled` means the user deliberately
 * persisted settings for it, and its credentials may legitimately live
 * outside the catalog (Bedrock IAM/profile auth, env-var keys, keyless
 * local endpoints like Ollama), so an empty optional API-key field must not
 * disqualify it. A brand-new user has no enabled providers, so the notice
 * still shows for them.
 */
export function isProviderConnected(provider: Provider): boolean {
	if (provider.apiKey?.trim()) {
		return true;
	}
	if (provider.oauthAccessTokenPresent) {
		return true;
	}
	if (!provider.enabled) {
		return false;
	}
	const requiredFields = (provider.configFields ?? []).filter(
		(field) => field.required,
	);
	return requiredFields.every((field) => {
		const value = provider.configValues?.[field.path];
		if (value === null || value === undefined) {
			return false;
		}
		return String(value).trim() !== "";
	});
}
