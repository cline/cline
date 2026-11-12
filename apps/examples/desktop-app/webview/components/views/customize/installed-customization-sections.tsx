import { SectionHeading } from "@cline/ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PaginationFooter } from "../shared/pagination-footer";
import { usePagination } from "../shared/use-pagination";
import { InstalledConnectorsView } from "./connectors/composio-connectors-view";
import { HooksSection } from "./extensions/hooks-section";
import type { InstalledPluginSelection } from "./extensions/installed-plugin-detail";
import type { InstalledSkillSelection } from "./extensions/installed-skill-detail";
import { PluginsSection } from "./extensions/plugins-section";
import type { RuleSelection } from "./extensions/rule-detail-page";
import { RulesSection } from "./extensions/rules-section";
import { SkillsSection } from "./extensions/skills-section";
import { ToolsSection } from "./extensions/tools-section";
import type { WorkflowSelection } from "./extensions/workflow-detail-page";
import type { InstalledMcpSelection } from "./mcp/mcp-types";
import { McpServersContent } from "./mcp/mcp-view";
import {
	CUSTOMIZE_CATEGORIES,
	type CustomizationKind,
} from "./navigation/customize-categories";
import { useCustomizeCategoryFilter } from "./navigation/customize-category-filter";
import { CustomizationEmptyState } from "./shared/customization-empty-state";
import type { useInstalledCustomizations } from "./use-installed-customizations";

const MANAGE_PREVIEW_LIMIT = 6;
const MANAGE_PAGE_SIZE = 20;

/** Where cards lead: the host owns detail pages and other destinations. */
export type InstalledCustomizationActions = {
	onCreateMcp: (trigger?: HTMLButtonElement) => void;
	onOpenModelProviders: () => void;
	onOpenPlugin: (
		selection: InstalledPluginSelection,
		trigger?: HTMLButtonElement,
	) => void;
	onOpenSkill: (
		selection: InstalledSkillSelection,
		trigger?: HTMLButtonElement,
	) => void;
	onOpenRule: (selection: RuleSelection, trigger?: HTMLButtonElement) => void;
	onOpenWorkflow: (
		selection: WorkflowSelection,
		trigger?: HTMLButtonElement,
	) => void;
	onOpenMcp: (
		selection: InstalledMcpSelection,
		trigger?: HTMLButtonElement,
	) => void;
};

/** Domain sections shared by Manage and search, without page navigation or search aggregation. */
export function InstalledCustomizationSections({
	model,
	actions,
	onViewAll,
}: {
	model: ReturnType<typeof useInstalledCustomizations>;
	actions: InstalledCustomizationActions;
	onViewAll?: (category: CustomizationKind) => void;
}) {
	const {
		onOpenModelProviders,
		onOpenSkill,
		onOpenWorkflow,
		onOpenRule,
		onOpenPlugin,
		onOpenMcp,
		onCreateMcp,
	} = actions;
	const {
		hasCategoryFilter,
		includeBuiltinItems,
		searchQuery,
		searchResults,
		tab,
		searchStates,
		marketplaceModels,
		connectorModel,
		normalizedQuery,
		isCategoryEmpty,
		handleInventoryChanged,
	} = model;
	const isManageOverview =
		!searchResults && tab === "all" && !normalizedQuery && !hasCategoryFilter;
	const categoryFilter = useCustomizeCategoryFilter();
	const selectedCategory = !searchResults
		? CUSTOMIZE_CATEGORIES.find((category) => category.id === tab)
		: undefined;
	const selectedState = selectedCategory
		? searchStates[selectedCategory.id]
		: undefined;
	const total =
		selectedCategory && !isCategoryEmpty(selectedCategory.id)
			? (selectedState?.count ?? 0)
			: 0;
	const { page, offset, contentRef, onPageChange } = usePagination({
		total,
		pageSize: MANAGE_PAGE_SIZE,
		resetKey: JSON.stringify([
			selectedCategory?.id,
			normalizedQuery,
			categoryFilter?.category?.id,
		]),
		holdPage: selectedState?.loading,
	});
	const itemOffset = selectedCategory ? offset : 0;
	function renderCategory(category: CustomizationKind) {
		if (hasCategoryFilter && ["rules", "hooks", "tools"].includes(category)) {
			return (
				<CustomizationEmptyState
					itemLabel={category}
					qualifier="in this category"
				/>
			);
		}
		const searchProps = {
			includeBuiltinItems,
			searchQuery,
			searchResults,
			previewLimit: isManageOverview
				? MANAGE_PREVIEW_LIMIT
				: selectedCategory
					? MANAGE_PAGE_SIZE
					: undefined,
			itemOffset,
			onViewAll:
				isManageOverview && onViewAll ? () => onViewAll(category) : undefined,
		};
		// One entry per kind, so a new category cannot be added without a section.
		const sections: Record<CustomizationKind, () => ReactNode> = {
			skills: () => (
				<SkillsSection
					{...searchProps}
					marketplaceModel={marketplaceModels.skills}
					onOpenSkill={onOpenSkill}
					onOpenWorkflow={onOpenWorkflow}
					onInventoryChanged={handleInventoryChanged}
				/>
			),
			mcp: () => (
				<McpServersContent
					{...searchProps}
					marketplaceModel={marketplaceModels.mcp}
					onCreateMcp={onCreateMcp}
					onOpenMcp={onOpenMcp}
					onInventoryChanged={handleInventoryChanged}
				/>
			),
			connectors: () => (
				<InstalledConnectorsView {...searchProps} model={connectorModel} />
			),
			plugins: () => (
				<PluginsSection
					{...searchProps}
					marketplaceModel={marketplaceModels.plugins}
					onOpenPlugin={onOpenPlugin}
					onInventoryChanged={handleInventoryChanged}
				/>
			),
			rules: () => (
				<RulesSection
					{...searchProps}
					onOpenRule={onOpenRule}
					onInventoryChanged={handleInventoryChanged}
				/>
			),
			hooks: () => (
				<HooksSection
					{...searchProps}
					onInventoryChanged={handleInventoryChanged}
				/>
			),
			tools: () => (
				<ToolsSection
					{...searchProps}
					onInventoryChanged={handleInventoryChanged}
					onOpenModelProviders={onOpenModelProviders}
				/>
			),
		};
		return sections[category]();
	}

	return (
		<div
			ref={contentRef}
			className={cn(
				"grid min-w-0 items-start gap-4 [overflow-anchor:none]",
				selectedCategory && "grid-rows-[1fr_auto]",
			)}
		>
			{CUSTOMIZE_CATEGORIES.filter((category) => {
				if (searchResults)
					return (
						searchStates[category.id].count > 0 ||
						searchStates[category.id].error
					);
				return tab === "all"
					? !isCategoryEmpty(category.id)
					: category.id === tab;
			}).map((category) => (
				<section
					aria-label={`${category.label} inventory`}
					className="min-w-0"
					key={category.id}
				>
					{searchResults ? (
						<SectionHeading
							className="mb-4"
							title={category.label}
							count={searchStates[category.id]?.count}
							headingLevel={4}
						/>
					) : null}
					{renderCategory(category.id)}
				</section>
			))}
			{selectedCategory ? (
				<PaginationFooter
					aria-label={`${selectedCategory.label} pages`}
					page={page}
					pageSize={MANAGE_PAGE_SIZE}
					total={total}
					onPageChange={onPageChange}
				/>
			) : null}
			{!searchResults &&
			tab === "all" &&
			CUSTOMIZE_CATEGORIES.every(({ id }) => isCategoryEmpty(id)) ? (
				<CustomizationEmptyState
					itemLabel="customizations"
					illustrated={!hasCategoryFilter && !normalizedQuery}
					message={
						hasCategoryFilter || normalizedQuery
							? undefined
							: "Extend what Cline can do with customizations."
					}
					marketplaceType={null}
					qualifier={
						hasCategoryFilter || normalizedQuery
							? "for the current filters"
							: undefined
					}
				/>
			) : null}
		</div>
	);
}
