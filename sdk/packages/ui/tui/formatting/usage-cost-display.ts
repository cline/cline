import {
	resolveProviderUsageCostDisplay,
	shouldShowProviderUsageCost,
} from "@cline/llms";

export function shouldShowCliUsageCost(providerId: string): boolean {
	return shouldShowProviderUsageCost(providerId);
}

export function shouldShowCliUsageCoveredBySubscription(
	providerId: string,
): boolean {
	return resolveProviderUsageCostDisplay(providerId) === "subscription";
}
