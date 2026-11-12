import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import type { MarketplaceEntry } from "@/lib/marketplace";
import {
	type InstalledCustomizationActions,
	InstalledCustomizationSections,
} from "../installed-customization-sections";
import { MarketplaceResults } from "../marketplace/marketplace-results";
import { useCustomizeSearch } from "./use-customize-search";

export function CustomizeSearchResults({
	query,
	actions,
	onOpenMarketplaceDetail,
}: {
	query: string;
	actions: InstalledCustomizationActions;
	onOpenMarketplaceDetail: (
		entry: MarketplaceEntry,
		trigger?: HTMLButtonElement,
	) => void;
}) {
	const { installed, marketplace, loading, count, hasError } =
		useCustomizeSearch(query, onOpenMarketplaceDetail);
	const installedState = installed.summary;
	const marketplaceState = marketplace.summary;
	const showInstalled = installedState.count > 0 || installedState.error;
	const showMarketplace = marketplaceState.count > 0 || marketplaceState.error;

	return (
		<ScrollArea className="[&>[data-slot=scroll-area-viewport]>div]:block! min-h-0 min-w-0 flex-1">
			<div className="grid min-w-0 gap-8 pb-6">
				<output className="flex items-center gap-2 text-muted-foreground text-sm">
					{loading ? (
						<>
							<Spinner aria-hidden="true" /> Searching customizations…
						</>
					) : count > 0 ? (
						`${count} ${count === 1 ? "result" : "results"}`
					) : !hasError ? (
						`No customizations match “${query.trim()}”.`
					) : (
						"Some search results could not be loaded."
					)}
				</output>
				<section
					aria-label="Installed search results"
					className="min-w-0"
					hidden={!showInstalled}
				>
					<h3 className="mb-5 font-medium text-foreground text-lg">
						Installed
					</h3>
					{showInstalled ? (
						<InstalledCustomizationSections
							model={installed}
							actions={actions}
						/>
					) : null}
				</section>
				<section
					aria-label="Marketplace search results"
					className="min-w-0"
					hidden={!showMarketplace}
				>
					<h3 className="mb-5 font-medium text-foreground text-lg">
						Marketplace
					</h3>
					{showMarketplace ? <MarketplaceResults model={marketplace} /> : null}
				</section>
			</div>
		</ScrollArea>
	);
}
