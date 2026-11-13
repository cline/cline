import type { MarketplaceEntry } from "@/lib/marketplace";
import { useMarketplaceResults } from "../marketplace/use-marketplace-results";
import { useInstalledCustomizations } from "../use-installed-customizations";

/** Derive both result groups and their combined status before rendering either group. */
export function useCustomizeSearch(
	query: string,
	onOpenDetail: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void,
) {
	const installed = useInstalledCustomizations({
		searchQuery: query,
		searchResults: true,
	});
	const marketplace = useMarketplaceResults({
		searchQuery: query,
		searchResults: true,
		onOpenDetail,
	});
	return {
		installed,
		marketplace,
		loading: installed.summary.loading || marketplace.summary.loading,
		count: installed.summary.count + marketplace.summary.count,
		hasError: installed.summary.error || marketplace.summary.error,
	};
}
