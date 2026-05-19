import { normalizeProviderId } from "./ids";
import { getProviderCollectionSync } from "./model-registry";

export type ProviderUsageCostDisplay = "show" | "hide";

function resolveMetadataUsageCostDisplay(
	metadata: Record<string, unknown> | undefined,
): ProviderUsageCostDisplay {
	return metadata?.usageCostDisplay === "hide" ? "hide" : "show";
}

export function resolveProviderUsageCostDisplay(
	providerId: string,
): ProviderUsageCostDisplay {
	const provider = getProviderCollectionSync(
		normalizeProviderId(providerId.trim()),
	)?.provider;
	return resolveMetadataUsageCostDisplay(provider?.metadata);
}

export function shouldShowProviderUsageCost(providerId: string): boolean {
	return resolveProviderUsageCostDisplay(providerId) === "show";
}
