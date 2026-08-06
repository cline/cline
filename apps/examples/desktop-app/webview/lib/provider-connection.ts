import type { Provider } from "@/lib/provider-schema";

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
