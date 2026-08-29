import { isProviderSettingsUsable, ProviderSettingsManager } from "@cline/core";

export function isProviderConfigured(config: {
	apiKey?: string;
	providerId: string;
}): boolean {
	if (config.apiKey?.trim()) {
		return true;
	}
	const manager = new ProviderSettingsManager();
	const settings = manager.getProviderSettings(config.providerId);
	const providerConfig = manager.getProviderConfig(config.providerId, {
		includeKnownModels: false,
	});
	return isProviderSettingsUsable(config.providerId, settings, providerConfig);
}
