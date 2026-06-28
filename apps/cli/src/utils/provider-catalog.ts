import {
	listLocalProviders as internalListLocalProviders,
	type ProviderSettingsManager,
} from "@cline/core";
import { getCliFeatureFlagsService } from "./feature-flags";

export function getCliProviderDisplayName(
	providerId: string,
	providerName?: string,
): string {
	if (providerId === "cline") {
		return "Cline Usage-Billing";
	}
	return providerName?.trim() || providerId;
}

export async function listLocalProviders(
	manager: ProviderSettingsManager,
): ReturnType<typeof internalListLocalProviders> {
	const catalog = await internalListLocalProviders(manager, {
		isClinePassEnabled:
			getCliFeatureFlagsService().getBooleanFlagEnabled("ext-cline-pass"),
	});
	return {
		...catalog,
		providers: catalog.providers.map((provider) => ({
			...provider,
			name: getCliProviderDisplayName(provider.id, provider.name),
		})),
	};
}
