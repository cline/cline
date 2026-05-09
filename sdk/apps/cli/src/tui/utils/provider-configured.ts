import { ProviderSettingsManager } from "@clinebot/core";
import { isProviderSettingsUsable } from "../../utils/provider-readiness";
import type { TuiProps } from "../types";

export function isProviderConfigured(config: TuiProps["config"]): boolean {
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
