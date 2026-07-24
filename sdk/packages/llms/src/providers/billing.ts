import {
	type GatewayUsageCostDisplay,
	USAGE_COST_DISPLAYS,
} from "@cline/shared";
import { normalizeProviderId } from "./ids";
import { getProviderCollectionSync } from "./model-registry";

export type ProviderUsageCostDisplay = GatewayUsageCostDisplay;

const isValidMetadataUsage = (
	usageCostDisplay: unknown,
): usageCostDisplay is ProviderUsageCostDisplay => {
	return (
		!!usageCostDisplay &&
		typeof usageCostDisplay === "string" &&
		USAGE_COST_DISPLAYS.includes(usageCostDisplay as ProviderUsageCostDisplay)
	);
};

function resolveMetadataUsageCostDisplay(
	metadata: Record<string, unknown> | undefined,
): ProviderUsageCostDisplay {
	if (isValidMetadataUsage(metadata?.usageCostDisplay)) {
		return metadata.usageCostDisplay;
	}
	return "show";
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
