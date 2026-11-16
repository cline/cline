import { useEffect, useMemo } from "react";
import type { ComposioCatalogToolkit } from "@/lib/composio-types";
import { subscribeToExtensionInventoryInvalidation } from "@/lib/extension-inventory";
import { useComposioCatalog } from "@/lib/use-composio-catalog";
import { useComposioStatus } from "@/lib/use-composio-status";
import {
	matchesCustomizeCategory,
	useCustomizeCategoryFilter,
} from "../navigation/customize-category-filter";
import { normalizeCustomizationQuery } from "../search/customize-search-state";

/** Search connector names, descriptions, slugs, and categories. */
export function connectorMatchesQuery(
	entry: ComposioCatalogToolkit,
	trimmedQuery: string,
): boolean {
	return (
		entry.slug.toLowerCase().includes(trimmedQuery) ||
		entry.name.toLowerCase().includes(trimmedQuery) ||
		entry.description?.toLowerCase().includes(trimmedQuery) ||
		entry.categories?.some((category) =>
			category.toLowerCase().includes(trimmedQuery),
		) ||
		false
	);
}

/** Derive cards and counts together, independently of whether a view is mounted. */
export function useConnectorResults({
	searchQuery = "",
	searchResults = false,
	excludeConnected = false,
	variant = "catalog",
}: {
	searchQuery?: string;
	searchResults?: boolean;
	excludeConnected?: boolean;
	variant?: "catalog" | "installed";
} = {}) {
	const { status, error: loadError, refresh } = useComposioStatus();
	useEffect(
		() => subscribeToExtensionInventoryInvalidation(() => void refresh()),
		[refresh],
	);
	const configured = status?.configured ?? false;
	const {
		catalog: response,
		loading: catalogLoading,
		error: catalogError,
		refresh: refreshCatalog,
	} = useComposioCatalog(configured);
	const catalog = response?.toolkits ?? null;
	const sharedCategoryFilter = useCustomizeCategoryFilter();
	const category = searchResults
		? null
		: (sharedCategoryFilter?.category ?? null);
	const trimmedQuery = normalizeCustomizationQuery(searchQuery);
	const statusBySlug = useMemo(
		() =>
			new Map(
				status?.integrations.map((entry) => [entry.toolkit, entry]) ?? [],
			),
		[status],
	);
	const installedEntries = useMemo<ComposioCatalogToolkit[]>(() => {
		const catalogBySlug = new Map(
			(catalog ?? []).map((entry) => [entry.slug, entry]),
		);
		return (status?.integrations ?? [])
			.filter((integration) => integration.status !== "not_connected")
			.map((integration) => ({
				...catalogBySlug.get(integration.toolkit),
				slug: integration.toolkit,
				name:
					integration.name ||
					catalogBySlug.get(integration.toolkit)?.name ||
					integration.toolkit,
				description:
					integration.description ||
					catalogBySlug.get(integration.toolkit)?.description,
				logo: integration.logo || catalogBySlug.get(integration.toolkit)?.logo,
				recommended: integration.recommended,
			}));
	}, [status, catalog]);
	const matchingInstalled = useMemo(
		() =>
			installedEntries.filter(
				(entry) =>
					matchesCustomizeCategory(category, entry.categories) &&
					(!trimmedQuery || connectorMatchesQuery(entry, trimmedQuery)),
			),
		[installedEntries, category, trimmedQuery],
	);
	const matchingCatalog = useMemo(
		() =>
			(catalog ?? []).filter(
				(entry) =>
					(!excludeConnected ||
						(statusBySlug.get(entry.slug)?.status ?? "not_connected") ===
							"not_connected") &&
					matchesCustomizeCategory(category, entry.categories) &&
					(!trimmedQuery || connectorMatchesQuery(entry, trimmedQuery)),
			),
		[catalog, excludeConnected, statusBySlug, category, trimmedQuery],
	);
	return {
		status,
		statusBySlug,
		configured,
		loadError,
		catalog,
		catalogError,
		catalogLoading,
		installedEntries,
		matchingInstalled,
		matchingCatalog,
		category,
		trimmedQuery,
		refreshCatalog,
		refreshStatus: refresh,
		summary: {
			query: trimmedQuery,
			count: configured
				? variant === "installed"
					? matchingInstalled.length
					: matchingCatalog.length
				: 0,
			loading:
				!loadError && (!status || (configured && !catalog && !catalogError)),
			error: Boolean(loadError || catalogError),
		},
	};
}

export type ConnectorResults = ReturnType<typeof useConnectorResults>;
