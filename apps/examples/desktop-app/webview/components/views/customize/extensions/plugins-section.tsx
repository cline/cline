import { Switch } from "@cline/ui";
import { Puzzle } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import type { PluginItem } from "@/lib/extension-inventory";
import type { MarketplaceEntry } from "@/lib/marketplace";
import {
	extensionActionKey,
	useExtensionActions,
} from "@/lib/use-extension-actions";
import { InstalledMarketplaceItems } from "../marketplace/installed-marketplace-items";
import type {
	MarketplaceLocalInstalledItem,
	MarketplaceLocalInstalledItemRenderContext,
} from "../marketplace/installed-marketplace-types";
import type { InstalledMarketplaceModel } from "../marketplace/use-installed-marketplace-items";
import { CustomizationItemCard } from "../shared/customization-item-card";
import { usePrimaryButtonRefs } from "../shared/use-primary-button-refs";
import {
	ExtensionSectionLayout,
	type ExtensionSectionProps,
	type ItemScope,
	ScopeBadge,
} from "./extension-section-shared";
import {
	getScopedPlugins,
	pluginMarketplaceItem,
} from "./installed-marketplace-selectors";
import type { InstalledPluginSelection } from "./installed-plugin-detail";
import { useExtensionSection } from "./use-extension-section";

type PluginsSectionProps = ExtensionSectionProps & {
	marketplaceModel: InstalledMarketplaceModel;
	onOpenPlugin: (
		selection: InstalledPluginSelection,
		trigger?: HTMLButtonElement,
	) => void;
};

export function PluginsSection({
	marketplaceModel,
	onInventoryChanged,
	includeBuiltinItems,
	searchQuery,
	searchResults = false,
	onViewAll,
	previewLimit,
	itemOffset,
	onOpenPlugin,
}: PluginsSectionProps) {
	const state = useExtensionSection(onInventoryChanged, includeBuiltinItems);
	const scopedPlugins = useMemo(
		() => getScopedPlugins(state.inventory),
		[state.inventory],
	);
	const cardReturnFocusRef = useRef<HTMLButtonElement | null>(null);
	const primaryButtons = usePrimaryButtonRefs();
	const openPlugin = useCallback(
		(selection: InstalledPluginSelection, trigger?: HTMLButtonElement) => {
			if (trigger) cardReturnFocusRef.current = trigger;
			onOpenPlugin(selection, trigger);
		},
		[onOpenPlugin],
	);
	const { inventory, loading: isLoading, error: errorMessage, refresh } = state;
	const { warnings } = inventory;
	const { actions, togglePlugin } = useExtensionActions();
	const setPluginEnabled = async (
		plugin: PluginItem,
		entries: MarketplaceEntry[] = [],
	) => {
		if (plugin.toggleable === false) return;
		const trigger = cardReturnFocusRef.current;
		const result = await togglePlugin(plugin);
		if (result.status === "succeeded") onInventoryChanged?.();
		// A completed request may belong to a hidden list or an earlier selection.
		// Its shared error remains on the originating item without replacing another page.
		if (
			result.status === "failed" &&
			trigger?.isConnected &&
			!trigger.closest("[hidden]") &&
			cardReturnFocusRef.current === trigger
		) {
			openPlugin({ plugin, entries }, trigger);
		}
	};
	const summary = {
		...marketplaceModel.summary,
		loading: isLoading || marketplaceModel.summary.loading,
		error:
			Boolean(errorMessage) ||
			warnings.length > 0 ||
			marketplaceModel.summary.error,
	};
	const renderPluginCard = (
		{
			plugin,
			scope,
		}: {
			plugin: PluginItem;
			scope: ItemScope;
		},
		context?: MarketplaceLocalInstalledItemRenderContext,
	) => {
		const key = plugin.path;
		return (
			<CustomizationItemCard
				key={plugin.path}
				onClickCapture={() => {
					cardReturnFocusRef.current = primaryButtons.get(key) ?? null;
				}}
				title={plugin.name}
				icon={Puzzle}
				status={
					actions.get(extensionActionKey("plugin", key))?.pending
						? undefined
						: ((actions.get(extensionActionKey("plugin", key))?.error
								? "action-failed"
								: undefined) ??
							(plugin.loadError?.trim()
								? plugin.agentPlugin === true && plugin.toggleable === false
									? "invalid-plugin"
									: "load-error"
								: undefined))
				}
				authorName={
					context?.matchedEntries?.find((entry) => entry.type === "plugin")
						?.author?.name
				}
				description={plugin.description?.trim() || undefined}
				primaryAction={{
					ref: primaryButtons.ref(key),
					label: `View ${plugin.name} details`,
					onClick: (event) =>
						openPlugin(
							{
								plugin,
								scope,
								entries: context?.matchedEntries ?? [],
							},
							event.currentTarget,
						),
				}}
				badges={<ScopeBadge scope={scope} />}
				actions={
					<Switch
						size="sm"
						tone="neutral"
						checked={plugin.enabled}
						onCheckedChange={() => {
							void setPluginEnabled(plugin, context?.matchedEntries);
						}}
						disabled={
							plugin.toggleable === false ||
							Boolean(
								actions.get(extensionActionKey("plugin", plugin.path))?.pending,
							)
						}
						aria-label={`Enable ${plugin.name}`}
					/>
				}
			/>
		);
	};
	const installedCatalogLocalItems = scopedPlugins.map(
		(item): MarketplaceLocalInstalledItem => ({
			...pluginMarketplaceItem(item.plugin),
			render: (context) => renderPluginCard(item, context),
		}),
	);
	const handleRefresh = useCallback(async () => {
		await refresh(true);
	}, [refresh]);
	const inventoryCount =
		summary.loading || summary.error ? undefined : summary.count;
	return (
		<ExtensionSectionLayout
			title="Plugins"
			count={inventoryCount}
			loading={isLoading}
			loadError={state.loadError}
			actionError={state.actionError}
			warnings={warnings}
			searchResults={searchResults}
			onViewAll={onViewAll}
			onRefresh={handleRefresh}
		>
			<InstalledMarketplaceItems
				model={marketplaceModel}
				previewLimit={previewLimit}
				itemOffset={itemOffset}
				installedItems={installedCatalogLocalItems}
				onInstalledItemsChanged={() => refresh()}
				onOpenPlugin={(entry, trigger) => openPlugin({ entry }, trigger)}
				primitive="plugin"
				searchQuery={searchQuery}
				searchResults={searchResults}
				showInstalledHeading={false}
			/>
		</ExtensionSectionLayout>
	);
}
