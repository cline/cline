import type { MarketplaceTypeFilter } from "../marketplace/marketplace-type-meta";

/** Shared order and identity for Browse and Manage category navigation. */
export const CUSTOMIZE_CATEGORIES = [
	{
		id: "connectors",
		label: "Connectors",
		browseType: "connector",
		beta: true,
	},
	{ id: "plugins", label: "Plugins", browseType: "plugin", beta: false },
	{ id: "skills", label: "Skills", browseType: "skill", beta: false },
	{ id: "mcp", label: "MCP", browseType: "mcp", beta: false },
	{ id: "tools", label: "Tools", browseType: null, beta: false },
	{ id: "rules", label: "Rules", browseType: null, beta: false },
	{ id: "hooks", label: "Hooks", browseType: null, beta: false },
] as const satisfies readonly {
	id: string;
	label: string;
	browseType: MarketplaceTypeFilter | null;
	beta: boolean;
}[];

export type CustomizationKind = (typeof CUSTOMIZE_CATEGORIES)[number]["id"];
export type CustomizeTab = "all" | CustomizationKind;

export const BROWSE_CATEGORIES = CUSTOMIZE_CATEGORIES.filter(
	(category) => category.browseType !== null,
);

/** Inventory-only categories have no Browse counterpart. */
export function customizeTabToBrowseFilter(
	tab: CustomizeTab,
): MarketplaceTypeFilter | null | undefined {
	if (tab === "all") return null;
	return (
		CUSTOMIZE_CATEGORIES.find((category) => category.id === tab)?.browseType ??
		undefined
	);
}

export function browseFilterToCustomizeTab(
	filter: MarketplaceTypeFilter | null,
): CustomizeTab {
	return (
		BROWSE_CATEGORIES.find((category) => category.browseType === filter)?.id ??
		"all"
	);
}
