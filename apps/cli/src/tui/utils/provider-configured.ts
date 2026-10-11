import {
	isProviderSettingsUsable,
	Llms,
	ProviderSettingsManager,
} from "@cline/core";
import type { TuiProps } from "../types";

/**
 * The provider's API key from its environment variable (for example
 * `OPENROUTER_API_KEY`), the way the runtime falls back to it when no key is
 * saved. Only providers that declare exactly one environment variable qualify:
 * those are all credentials. Providers with several (Bedrock, Vertex, ...) mix
 * in configuration such as a region, project or host, so they still need `-k`
 * or saved settings.
 */
export function getProviderApiKeyFromEnv(
	providerId: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const id = Llms.normalizeProviderId(providerId);
	const names = Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID[id]?.provider.env ?? [];
	if (names.length !== 1) {
		return undefined;
	}
	return env[names[0]]?.trim() || undefined;
}

export function hasProviderApiKeyInEnv(
	providerId: string,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return getProviderApiKeyFromEnv(providerId, env) !== undefined;
}

export function isProviderConfigured(
	config: TuiProps["config"],
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (config.apiKey?.trim()) {
		return true;
	}
	const manager = new ProviderSettingsManager();
	const settings = manager.getProviderSettings(config.providerId);
	const providerConfig = manager.getProviderConfig(config.providerId, {
		includeKnownModels: false,
	});
	if (isProviderSettingsUsable(config.providerId, settings, providerConfig)) {
		return true;
	}
	const envApiKey = getProviderApiKeyFromEnv(config.providerId, env);
	if (!envApiKey) {
		return false;
	}
	// The environment key stands in for a saved one; the provider's other
	// requirements still apply.
	return isProviderSettingsUsable(
		config.providerId,
		{ ...settings, provider: config.providerId, apiKey: envApiKey },
		providerConfig,
	);
}
