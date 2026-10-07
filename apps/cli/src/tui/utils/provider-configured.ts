import {
	isProviderSettingsUsable,
	Llms,
	ProviderSettingsManager,
} from "@cline/core";
import type { TuiProps } from "../types";

/**
 * Whether the provider's API key is set in one of its documented environment
 * variables (for example `OPENROUTER_API_KEY`). The runtime falls back to
 * these when no key is saved, so a session can start without one on disk.
 */
export function hasProviderApiKeyInEnv(
	providerId: string,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const id = Llms.normalizeProviderId(providerId);
	const names = Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID[id]?.provider.env ?? [];
	return names.some((name) => Boolean(env[name]?.trim()));
}

export function isProviderConfigured(config: TuiProps["config"]): boolean {
	if (config.apiKey?.trim()) {
		return true;
	}
	if (hasProviderApiKeyInEnv(config.providerId)) {
		return true;
	}
	const manager = new ProviderSettingsManager();
	const settings = manager.getProviderSettings(config.providerId);
	const providerConfig = manager.getProviderConfig(config.providerId, {
		includeKnownModels: false,
	});
	return isProviderSettingsUsable(config.providerId, settings, providerConfig);
}
