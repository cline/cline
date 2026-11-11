import type { MarketplaceEntry } from "@/lib/marketplace";
import {
	browseFilterToCustomizeTab,
	customizeTabToBrowseFilter,
} from "../navigation/customize-categories";
import { CustomizeCategoryBar } from "../navigation/customize-category-bar";
import { MarketplaceResults } from "./marketplace-results";
import type { MarketplaceTypeFilter } from "./marketplace-type-meta";
import { useMarketplaceResults } from "./use-marketplace-results";

/** Browse navigation over the same result model and cards used by search. */
export function MarketplaceExplorerView({
	typeFilter,
	onTypeFilterChange,
	onOpenDetail,
	onCreateMcp,
}: {
	typeFilter: MarketplaceTypeFilter | null;
	onTypeFilterChange: (filter: MarketplaceTypeFilter | null) => void;
	onOpenDetail: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void;
	onCreateMcp: (trigger?: HTMLButtonElement) => void;
}) {
	const model = useMarketplaceResults({
		typeFilter,
		onTypeFilterChange,
		onOpenDetail,
	});
	const { contentRef, categoriesRef, connectorsAvailable } = model;

	return (
		<div
			ref={contentRef}
			data-customize-sections=""
			className="flex min-h-0 min-w-0 flex-1 select-text flex-col"
		>
			<CustomizeCategoryBar
				ref={categoriesRef}
				mode="browse"
				value={browseFilterToCustomizeTab(typeFilter)}
				onValueChange={(category) =>
					onTypeFilterChange(customizeTabToBrowseFilter(category) ?? null)
				}
				connectorsAvailable={connectorsAvailable === true}
			/>
			<MarketplaceResults model={model} onCreateMcp={onCreateMcp} />
		</div>
	);
}
