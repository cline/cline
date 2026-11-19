import { useEffect, useMemo, useRef } from "react";
import type {
	MarketplaceEntry,
	MarketplacePrimitiveType,
} from "@/lib/marketplace";
import {
	marketplaceEntryKey as entryKey,
	marketplaceEntrySearchText as entrySearchText,
} from "@/lib/marketplace-entry";
import { useMarketplaceDirectory } from "@/lib/use-marketplace-directory";
import {
	matchesCustomizeCategory,
	useCustomizeCategoryFilter,
} from "../navigation/customize-category-filter";
import type {
	MarketplaceLocalInstalledListItem,
	MarketplaceLocalInstalledMetadata,
} from "./installed-marketplace-types";
import {
	entryMatchesLocalItem,
	findLocalMarketplaceMatch,
} from "./marketplace-local-match";

function compareFeaturedEntries(
	left: MarketplaceEntry,
	right: MarketplaceEntry,
): number {
	return Number(Boolean(right.featured)) - Number(Boolean(left.featured));
}

function normalizeMatchValue(value: string): string {
	return value.trim().toLowerCase();
}

/** Match local inventory to catalog entries once before rendering cards or reporting results. */
export function useInstalledMarketplaceItems({
	installedItems,
	onInstalledItemsChanged,
	primitive,
	searchQuery = "",
	searchResults = false,
}: {
	installedItems?: MarketplaceLocalInstalledMetadata[];
	onInstalledItemsChanged?: () => void | Promise<void>;
	primitive: MarketplacePrimitiveType;
	searchQuery?: string;
	searchResults?: boolean;
}) {
	const sharedCategoryFilter = useCustomizeCategoryFilter();
	const sharedCategory = searchResults
		? null
		: (sharedCategoryFilter?.category ?? null);
	const installedItemsSignature = useMemo(
		() =>
			JSON.stringify(
				(installedItems ?? []).map((item) => [item.key, ...item.matchValues]),
			),
		[installedItems],
	);
	const {
		catalog,
		errorMessage,
		loading,
		tagLabels,
		installedKeys: installedEntryKeys,
		installedReady: installedStatusReady,
		installedLoading,
		installedError,
		actionStates,
		uninstall,
		removeInstalledKeys,
	} = useMarketplaceDirectory(onInstalledItemsChanged, installedItemsSignature);
	const normalizedQuery = searchQuery.trim().toLowerCase();
	const primitiveEntries = useMemo(
		() =>
			(catalog?.entries.filter((entry) => entry.type === primitive) ?? []).sort(
				compareFeaturedEntries,
			),
		[catalog?.entries, primitive],
	);
	const queryFilteredEntries = useMemo(
		() =>
			primitiveEntries.filter(
				(entry) =>
					!normalizedQuery ||
					entrySearchText(entry, tagLabels).includes(normalizedQuery),
			),
		[primitiveEntries, normalizedQuery, tagLabels],
	);

	// Assign each installed marketplace entry to at most one local item so a
	// single entry's badge and setup guidance are never duplicated across
	// unrelated local cards that happen to share a broad match value.
	const matchedEntriesByLocalItemKey = useMemo(() => {
		const matched = new Map<string, MarketplaceEntry[]>();
		const items = installedItems ?? [];
		const installedMarketplaceEntries = primitiveEntries.filter((entry) =>
			installedEntryKeys.has(entryKey(entry)),
		);
		for (const entry of installedMarketplaceEntries) {
			const target = findLocalMarketplaceMatch(entry, items);
			if (!target) {
				// Still ambiguous: keep the entry on its own marketplace card
				// rather than guessing which local item it belongs to.
				continue;
			}
			const entries = matched.get(target.key) ?? [];
			entries.push(entry);
			matched.set(target.key, entries);
		}
		return matched;
	}, [installedEntryKeys, installedItems, primitiveEntries]);

	const matchedEntryKeys = useMemo(
		() =>
			new Set(
				[...matchedEntriesByLocalItemKey.values()].flatMap((entries) =>
					entries.map((entry) => entryKey(entry)),
				),
			),
		[matchedEntriesByLocalItemKey],
	);

	// Installed entry keys that are corroborated by at least one local item,
	// regardless of which single item the entry was assigned to above.
	const locallyEvidencedEntryKeys = useMemo(() => {
		const items = installedItems ?? [];
		return new Set(
			primitiveEntries
				.filter(
					(entry) =>
						installedEntryKeys.has(entryKey(entry)) &&
						items.some((item) => entryMatchesLocalItem(entry, item)),
				)
				.map((entry) => entryKey(entry)),
		);
	}, [installedEntryKeys, installedItems, primitiveEntries]);

	// When an entry loses all local items backing it (e.g. the matching server
	// was deleted through its own card controls), drop its installed key right
	// away without waiting for the async recheck — which could be slow or fail and briefly
	// resurrect the entry as an installed card.
	const previouslyEvidencedEntryKeysRef = useRef<Set<string>>(new Set());
	useEffect(() => {
		const orphanedKeys = [...previouslyEvidencedEntryKeysRef.current].filter(
			(key) => !locallyEvidencedEntryKeys.has(key),
		);
		previouslyEvidencedEntryKeysRef.current = locallyEvidencedEntryKeys;
		if (orphanedKeys.length === 0) {
			return;
		}
		removeInstalledKeys(orphanedKeys);
	}, [locallyEvidencedEntryKeys, removeInstalledKeys]);

	// Installed marketplace entries that have a matching local item are rendered
	// through that item's own card, so only unmatched entries fall back to the
	// marketplace entry card here.
	const installedEntries = useMemo(
		() =>
			queryFilteredEntries.filter(
				(entry) =>
					installedEntryKeys.has(entryKey(entry)) &&
					!matchedEntryKeys.has(entryKey(entry)) &&
					matchesCustomizeCategory(sharedCategory, entry.tags),
			),
		[
			queryFilteredEntries,
			installedEntryKeys,
			matchedEntryKeys,
			sharedCategory,
		],
	);

	const localInstalledItems = useMemo(() => {
		return (installedItems ?? [])
			.map(
				(item): MarketplaceLocalInstalledListItem => ({
					item,
					matchedEntries: matchedEntriesByLocalItemKey.get(item.key) ?? [],
				}),
			)
			.filter(({ item, matchedEntries }) => {
				if (
					sharedCategory &&
					!matchedEntries.some((entry) =>
						matchesCustomizeCategory(sharedCategory, entry.tags),
					)
				) {
					return false;
				}
				if (normalizedQuery.length === 0) {
					return true;
				}
				if (
					[...item.matchValues, ...(item.searchText ?? [])]
						.map(normalizeMatchValue)
						.some((value) => value.includes(normalizedQuery))
				) {
					return true;
				}
				return matchedEntries.some((entry) =>
					entrySearchText(entry, tagLabels).includes(normalizedQuery),
				);
			});
	}, [
		installedItems,
		matchedEntriesByLocalItemKey,
		normalizedQuery,
		sharedCategory,
		tagLabels,
	]);

	const catalogResultsReady = Boolean(catalog) && installedStatusReady;
	const searchCount =
		localInstalledItems.length +
		(catalogResultsReady ? installedEntries.length : 0);
	const searchLoading = loading || installedLoading;
	const searchError = Boolean(errorMessage || installedError);

	return {
		summary: {
			query: normalizedQuery,
			count: searchCount,
			loading: searchLoading,
			error: searchError,
		},
		catalog,
		errorMessage,
		loading,
		tagLabels,
		installedStatusReady,
		installedError,
		actionStates,
		uninstall,
		sharedCategory,
		catalogResultsReady,
		searchCount,
		installedEntries,
		localInstalledItems,
	};
}

export type InstalledMarketplaceModel = ReturnType<
	typeof useInstalledMarketplaceItems
>;
