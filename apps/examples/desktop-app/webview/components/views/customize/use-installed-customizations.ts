import { useCallback, useMemo } from "react";
import { filterBuiltinInventory } from "@/lib/extension-inventory";
import { useExtensionInventory } from "@/lib/use-extension-inventory";
import { useMcpInventory } from "@/lib/use-mcp-inventory";
import { useConnectorResults } from "./connectors/use-connector-results";
import {
	selectInstalledHooks,
	selectInstalledRules,
	selectInstalledTools,
} from "./extensions/installed-inventory-selectors";
import {
	getInstalledCommands,
	getInstalledMcpServers,
	getScopedPlugins,
	mcpMarketplaceItem,
	pluginMarketplaceItem,
	skillMarketplaceItem,
} from "./extensions/installed-marketplace-selectors";
import { useInstalledMarketplaceItems } from "./marketplace/use-installed-marketplace-items";
import {
	CUSTOMIZE_CATEGORIES,
	type CustomizationKind,
	type CustomizeTab,
} from "./navigation/customize-categories";
import { useCustomizeCategoryFilter } from "./navigation/customize-category-filter";
import type { CustomizeSearchState } from "./search/customize-search-state";
import { useCustomizeRefresh } from "./shared/customize-refresh";

/** Resolve every installed result source before mounting any category renderer. */
export function useInstalledCustomizations({
	searchQuery = "",
	searchResults = false,
	tab = "all",
}: {
	searchQuery?: string;
	searchResults?: boolean;
	tab?: CustomizeTab;
} = {}) {
	const categoryFilter = useCustomizeCategoryFilter();
	const hasCategoryFilter = !searchResults && categoryFilter?.category != null;
	const { inventory, loading, error, refresh } = useExtensionInventory();
	const {
		response: mcpInventory,
		loading: mcpLoading,
		error: mcpError,
		refresh: refreshMcpInventory,
	} = useMcpInventory();
	const includeBuiltinItems = searchResults || tab !== "all";
	const visibleInventory = useMemo(
		() =>
			inventory ? filterBuiltinInventory(inventory, includeBuiltinItems) : null,
		[inventory, includeBuiltinItems],
	);
	const skillItems = useMemo(
		() =>
			visibleInventory
				? getInstalledCommands(visibleInventory).map(skillMarketplaceItem)
				: [],
		[visibleInventory],
	);
	const pluginItems = useMemo(
		() =>
			visibleInventory
				? getScopedPlugins(visibleInventory).map(({ plugin }) =>
						pluginMarketplaceItem(plugin),
					)
				: [],
		[visibleInventory],
	);
	const mcpItems = useMemo(
		() =>
			getInstalledMcpServers(
				mcpInventory?.servers ?? [],
				includeBuiltinItems,
			).map(mcpMarketplaceItem),
		[mcpInventory, includeBuiltinItems],
	);
	const handleInventoryChanged = useCallback(() => {
		void refresh();
	}, [refresh]);
	const marketplaceOptions = {
		searchQuery,
		searchResults,
		onInstalledItemsChanged: handleInventoryChanged,
	};
	const skills = useInstalledMarketplaceItems({
		...marketplaceOptions,
		primitive: "skill",
		installedItems: skillItems,
	});
	const plugins = useInstalledMarketplaceItems({
		...marketplaceOptions,
		primitive: "plugin",
		installedItems: pluginItems,
	});
	const mcp = useInstalledMarketplaceItems({
		...marketplaceOptions,
		primitive: "mcp",
		installedItems: mcpItems,
	});
	const connectors = useConnectorResults({
		searchQuery,
		searchResults,
		variant: "installed",
	});
	const refreshAll = useCallback(async () => {
		await Promise.all([
			refresh(true),
			refreshMcpInventory(true),
			connectors.refreshStatus(),
			connectors.refreshCatalog(),
		]);
	}, [
		refresh,
		refreshMcpInventory,
		connectors.refreshStatus,
		connectors.refreshCatalog,
	]);
	// Empty categories can be unmounted: the data owner still participates in refresh.
	useCustomizeRefresh(refreshAll);

	const normalizedQuery = searchQuery.trim().toLowerCase();
	const inventoryError = Boolean(error || visibleInventory?.warnings.length);
	const inventoryState = (count: number): CustomizeSearchState => ({
		query: normalizedQuery,
		count,
		loading,
		error: inventoryError,
	});
	const withInventoryState = (
		state: CustomizeSearchState,
	): CustomizeSearchState => ({
		...state,
		loading: loading || state.loading,
		error: inventoryError || state.error,
	});
	const queryOptions = { searchQuery };
	const tools = visibleInventory
		? selectInstalledTools(visibleInventory, queryOptions)
		: null;
	const searchStates: Record<CustomizationKind, CustomizeSearchState> = {
		skills: withInventoryState(skills.summary),
		plugins: withInventoryState(plugins.summary),
		mcp: {
			...mcp.summary,
			loading: mcpLoading || mcp.summary.loading,
			error: Boolean(mcpError) || mcp.summary.error,
		},
		connectors: connectors.summary,
		rules: inventoryState(
			!hasCategoryFilter && visibleInventory
				? selectInstalledRules(visibleInventory, queryOptions).length
				: 0,
		),
		hooks: inventoryState(
			!hasCategoryFilter && visibleInventory
				? selectInstalledHooks(visibleInventory, queryOptions).length
				: 0,
		),
		tools: inventoryState(
			!hasCategoryFilter && tools
				? tools.filteredBuiltinTools.length + tools.filteredPluginTools.length
				: 0,
		),
	};
	const states = CUSTOMIZE_CATEGORIES.map(({ id }) => searchStates[id]);
	const summary: CustomizeSearchState = {
		query: normalizedQuery,
		count: states.reduce((total, state) => total + state.count, 0),
		loading: states.some((state) => state.loading),
		error: states.some((state) => state.error),
	};
	function isCategoryEmpty(category: CustomizationKind) {
		if (hasCategoryFilter && ["rules", "hooks", "tools"].includes(category))
			return true;
		const state = searchStates[category];
		return state.count === 0 && !state.loading && !state.error;
	}
	return {
		hasCategoryFilter,
		includeBuiltinItems,
		searchQuery,
		searchResults,
		tab,
		searchStates,
		marketplaceModels: { skills, plugins, mcp },
		connectorModel: connectors,
		normalizedQuery,
		summary,
		isCategoryEmpty,
		handleInventoryChanged,
	};
}
