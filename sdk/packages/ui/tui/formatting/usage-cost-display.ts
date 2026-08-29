import {
	resolveProviderUsageCostDisplay,
	shouldShowProviderUsageCost,
} from "@cline/llms";

export function shouldShowCliUsageCost(providerId: string): boolean {
	return shouldShowProviderUsageCost(providerId);
}

export function formatUsd(value: number, fixed = 6): string {
	if (!Number.isFinite(value) || value <= 0) {
		return "$0.00";
	}
	return `$${value.toFixed(fixed)}`;
}

export function shouldShowCliUsageCoveredBySubscription(
	providerId: string,
): boolean {
	return resolveProviderUsageCostDisplay(providerId) === "subscription";
}
