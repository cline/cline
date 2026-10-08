import {
	isProviderSettingsUsable,
	Llms,
	ProviderSettingsManager,
} from "@cline/core";
import type { TuiProps } from "../types";

/**
 * The provider's API key from one of its documented environment variables
 * (for example `OPENROUTER_API_KEY`), the way the runtime falls back to them
 * when no key is saved. Variables the runtime reads for something other than
 * the key (such as Bedrock's `AWS_REGION`) are skipped.
 */
export function getProviderApiKeyFromEnv(
	providerId: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const id = Llms.normalizeProviderId(providerId);
	const names = Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID[id]?.provider.env ?? [];
	for (const name of names) {
		if (!Llms.isProviderApiKeyEnv(id, name)) {
			continue;
		}
		const value = env[name]?.trim();
		if (value) {
			return value;
		}
	}
	return undefined;
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
	// requirements (a Bedrock region, a Vertex project, ...) still apply.
	return isProviderSettingsUsable(
		config.providerId,
		{ ...settings, provider: config.providerId, apiKey: envApiKey },
		providerConfig,
	);
}
