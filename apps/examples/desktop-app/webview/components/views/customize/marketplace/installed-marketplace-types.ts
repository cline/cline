import type { ReactNode } from "react";
import type { MarketplaceEntry } from "@/lib/marketplace";

export type MarketplaceLocalInstalledItemRenderContext = {
	matchedEntries?: MarketplaceEntry[];
};

export type MarketplaceLocalInstalledMetadata = {
	key: string;
	kind?: "skill" | "workflow";
	matchValues: string[];
	/** Searchable metadata that does not participate in marketplace deduplication. */
	searchText?: string[];
};

export type MarketplaceLocalInstalledItem =
	MarketplaceLocalInstalledMetadata & {
		render: (context?: MarketplaceLocalInstalledItemRenderContext) => ReactNode;
	};

export type MarketplaceLocalInstalledListItem = {
	item: MarketplaceLocalInstalledMetadata;
	matchedEntries: MarketplaceEntry[];
};
