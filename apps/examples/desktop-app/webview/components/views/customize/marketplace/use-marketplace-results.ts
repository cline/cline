import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MarketplaceEntry } from "@/lib/marketplace";
import {
	marketplaceEntryKey as entryKey,
	marketplaceEntrySearchText as entrySearchText,
} from "@/lib/marketplace-entry";
import { useMarketplaceDirectory } from "@/lib/use-marketplace-directory";
import {
	findScrollViewport,
	queryScrollViewports,
} from "../../shared/page-scroll";
import { useConnectorResults } from "../connectors/use-connector-results";
import { BROWSE_CATEGORIES } from "../navigation/customize-categories";
import {
	matchesCustomizeCategory,
	useCustomizeCategoryFilter,
} from "../navigation/customize-category-filter";
import { normalizeCustomizationQuery } from "../search/customize-search-state";
import { useCustomizeStickyHeaders } from "../shared/use-customize-sticky-headers";
import type { MarketplaceTypeFilter } from "./marketplace-type-meta";

const BROWSE_TYPE_ORDER = BROWSE_CATEGORIES.map(
	(category) => category.browseType,
).filter((type) => type !== "connector");
/**
 * Catalog results for Browse, which narrows them by type, and for search,
 * which narrows them by query and spans every type.
 */
export function useMarketplaceResults({
	typeFilter = null,
	onTypeFilterChange,
	searchQuery = "",
	searchResults = false,
	onOpenDetail,
}: {
	typeFilter?: MarketplaceTypeFilter | null;
	onTypeFilterChange?: (filter: MarketplaceTypeFilter | null) => void;
	searchQuery?: string;
	searchResults?: boolean;
	/** The Customize page owns catalog detail navigation and return focus. */
	onOpenDetail: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void;
}) {
	const directory = useMarketplaceDirectory();
	const pendingInlineInstalls = useRef(
		new Map<string, { entry: MarketplaceEntry; trigger: HTMLButtonElement }>(),
	);
	useEffect(() => {
		for (const [key, { entry, trigger }] of pendingInlineInstalls.current) {
			const state = directory.actionStates.get(key);
			if (state?.status === "failed") {
				pendingInlineInstalls.current.delete(key);
				trigger.focus({ preventScroll: true });
				onOpenDetail(entry, trigger);
			} else if (state?.status === "installed") {
				pendingInlineInstalls.current.delete(key);
			}
		}
	}, [directory.actionStates, onOpenDetail]);

	const query = searchQuery;
	const normalizedQuery = normalizeCustomizationQuery(query);
	const handleTypeFilterChange = useCallback(
		(filter: MarketplaceTypeFilter | null) => onTypeFilterChange?.(filter),
		[onTypeFilterChange],
	);
	const sharedCategoryFilter = useCustomizeCategoryFilter();
	const selectedTag = sharedCategoryFilter?.category?.id ?? null;
	const { contentRef, categoriesRef } = useCustomizeStickyHeaders(
		true,
		!searchResults,
	);
	const isBrowseOverview =
		!searchResults && typeFilter === null && !normalizedQuery && !selectedTag;
	const viewAll = (type: MarketplaceTypeFilter) => {
		handleTypeFilterChange(type);
		const viewport =
			findScrollViewport(contentRef.current) ??
			queryScrollViewports(contentRef.current)[0];
		if (viewport) viewport.scrollTop = 0;
	};
	const connectorModel = useConnectorResults({
		searchQuery: query,
		searchResults,
		excludeConnected: searchResults,
	});
	const connectorsAvailable =
		connectorModel.status?.configured ??
		(connectorModel.loadError ? false : null);
	const connectorSearchState = connectorModel.summary;
	const connectorAvailabilityError = Boolean(connectorModel.loadError);

	useEffect(() => {
		if (connectorsAvailable === false && typeFilter === "connector") {
			handleTypeFilterChange(null);
		}
	}, [connectorsAvailable, typeFilter, handleTypeFilterChange]);
	const showConnectors =
		connectorsAvailable === true &&
		(typeFilter === null || typeFilter === "connector");
	// Search spans catalog metadata before applying the shared topic filter.
	const typeAndQueryEntries = useMemo(() => {
		const entries = directory.catalog?.entries ?? [];
		const normalized = query.trim().toLowerCase();
		return entries.filter(
			(entry) =>
				(!typeFilter || entry.type === typeFilter) &&
				(normalized.length === 0 ||
					entrySearchText(entry, directory.tagLabels).includes(normalized)),
		);
	}, [directory.catalog?.entries, directory.tagLabels, query, typeFilter]);

	const filteredEntries = useMemo(
		() =>
			typeAndQueryEntries.filter(
				(entry) =>
					(searchResults ||
						matchesCustomizeCategory(
							sharedCategoryFilter?.category ?? null,
							entry.tags,
						)) &&
					(!searchResults ||
						(directory.installedReady &&
							!directory.installedError &&
							!directory.installedKeys.has(entryKey(entry)))),
			),
		[
			typeAndQueryEntries,
			sharedCategoryFilter,
			searchResults,
			directory.installedReady,
			directory.installedKeys,
			directory.installedError,
		],
	);

	const groups = useMemo(
		() =>
			searchResults
				? filteredEntries.length > 0
					? [{ type: "skill" as const, entries: filteredEntries }]
					: []
				: BROWSE_TYPE_ORDER.map((type) => ({
						type,
						entries: filteredEntries
							.filter((entry) => entry.type === type)
							.sort(
								(a, b) =>
									Number(Boolean(b.featured)) - Number(Boolean(a.featured)),
							),
					})).filter(
						(group) =>
							group.entries.length > 0 ||
							(typeFilter === "mcp" && group.type === "mcp"),
					),
		[filteredEntries, searchResults, typeFilter],
	);

	const connectorSearchReady = connectorSearchState?.query === normalizedQuery;
	const hideEmptyConnectors =
		!searchResults &&
		typeFilter === null &&
		connectorSearchReady &&
		!connectorSearchState.loading &&
		!connectorSearchState.error &&
		connectorSearchState.count === 0;
	const resultCount =
		filteredEntries.length +
		(showConnectors && connectorSearchReady ? connectorSearchState.count : 0);
	const resultsLoading =
		directory.loading ||
		(!directory.installedReady && !directory.errorMessage) ||
		connectorsAvailable === null ||
		(showConnectors && (!connectorSearchReady || connectorSearchState.loading));
	const resultsError = Boolean(
		directory.errorMessage ||
			directory.installedError ||
			connectorAvailabilityError ||
			(showConnectors && connectorSearchReady && connectorSearchState.error),
	);
	return {
		directory,
		pendingInlineInstalls,
		openDetails: onOpenDetail,
		query,
		typeFilter,
		contentRef,
		categoriesRef,
		isBrowseOverview,
		viewAll,
		connectorsAvailable,
		connectorSearchState,
		connectorModel,
		connectorAvailabilityError,
		showConnectors,
		groups,
		connectorSearchReady,
		hideEmptyConnectors,
		searchResults,
		summary: {
			query: normalizedQuery,
			count: resultCount,
			loading: resultsLoading,
			error: resultsError,
		},
	};
}
