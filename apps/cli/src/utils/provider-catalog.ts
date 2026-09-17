import type { ProviderSettingsManager } from "@cline/core";

export async function listLocalProviders(
	manager: ProviderSettingsManager,
): ReturnType<ProviderSettingsManager["listProviders"]> {
	return manager.listProviders({ isClinePassEnabled: true });
}
