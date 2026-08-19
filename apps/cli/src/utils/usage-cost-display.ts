import { Llms } from "@cline/core";

export function shouldShowCliUsageCost(providerId: string): boolean {
	return Llms.shouldShowProviderUsageCost(providerId);
}

export function shouldShowCliUsageCoveredBySubscription(
	providerId: string,
): boolean {
	return Llms.resolveProviderUsageCostDisplay(providerId) === "subscription";
}
