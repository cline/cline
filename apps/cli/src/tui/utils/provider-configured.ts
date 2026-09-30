import { isProviderSettingsUsable } from "@cline/core";
import { getCliProviderSettingsManager } from "../../utils/provider-settings";
import type { TuiProps } from "../types";

export function isProviderConfigured(config: TuiProps["config"]): boolean {
	if (config.apiKey?.trim()) {
		return true;
	}
	const manager = getCliProviderSettingsManager();
	const settings = manager.getProviderSettings(config.providerId);
	const providerConfig = manager.getProviderConfig(config.providerId, {
		includeKnownModels: false,
	});
	return isProviderSettingsUsable(config.providerId, settings, providerConfig);
}
