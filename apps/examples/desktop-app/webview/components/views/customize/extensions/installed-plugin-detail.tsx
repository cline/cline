"use client";

import {
	Badge,
	Button,
	DetailList,
	DetailListItem,
	SectionHeading,
	Switch,
} from "@cline/ui";
import { Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useIsMounted } from "@/hooks/use-is-mounted";
import type { PluginItem, ToolItem } from "@/lib/extension-inventory";
import type { MarketplaceEntry } from "@/lib/marketplace";
import { marketplaceEntryKey } from "@/lib/marketplace-entry";
import {
	extensionActionKey,
	useExtensionActions,
} from "@/lib/use-extension-actions";
import {
	type MarketplaceDirectory,
	useMarketplaceDirectory,
} from "@/lib/use-marketplace-directory";
import { entryActionLabel } from "../marketplace/marketplace-entry-action";
import { MarketplaceEntryDetails } from "../marketplace/marketplace-entry-details";
import { MarketplaceEntrySetupDetails } from "../marketplace/marketplace-entry-setup";
import { findLocalMarketplaceMatch } from "../marketplace/marketplace-local-match";
import { CustomizationDeleteDialog } from "../shared/customization-delete-dialog";
import { CustomizationDetailPage } from "../shared/customization-detail-page";
import { PathDetailListItem } from "../shared/path-detail-list-item";
import {
	getLocalMarketplaceMatchValues,
	getPathScope,
	type ItemScope,
} from "./extension-section-shared";
import { useExtensionSection } from "./use-extension-section";

export type InstalledPluginSelection = {
	plugin?: PluginItem;
	entry?: MarketplaceEntry;
	entries?: MarketplaceEntry[];
	scope?: ItemScope;
};

/**
 * What a selection refers to: the installed plugin (the inventory's current
 * copy, or the one matching a selected catalog entry) and every catalog entry
 * that describes it.
 */
function resolvePluginSelection(
	selection: InstalledPluginSelection,
	plugins: PluginItem[],
	directory: Pick<MarketplaceDirectory, "catalog" | "installedKeys">,
) {
	const selectedEntry = selection.entry ?? selection.entries?.[0];
	const candidates = plugins.map((plugin) => ({
		plugin,
		matchValues: getLocalMarketplaceMatchValues(plugin.name, plugin.path),
	}));
	const plugin = selection.plugin
		? (plugins.find((item) => item.path === selection.plugin?.path) ??
			selection.plugin)
		: selectedEntry &&
				directory.installedKeys.has(marketplaceEntryKey(selectedEntry))
			? findLocalMarketplaceMatch(selectedEntry, candidates)?.plugin
			: undefined;
	const matchedEntries = [
		...new Map(
			[
				...(selection.entries ?? []),
				...(selectedEntry ? [selectedEntry] : []),
				...(plugin
					? (directory.catalog?.entries.filter(
							(entry) =>
								entry.type === "plugin" &&
								directory.installedKeys.has(marketplaceEntryKey(entry)) &&
								findLocalMarketplaceMatch(entry, candidates)?.plugin.path ===
									plugin.path,
						) ?? [])
					: []),
			].map((entry) => [marketplaceEntryKey(entry), entry]),
		).values(),
	];
	const catalogEntry = selectedEntry ?? matchedEntries[0];
	/** The catalog's description of the plugin, completed from the installed copy. */
	const entry: MarketplaceEntry = {
		...catalogEntry,
		id: catalogEntry?.id ?? plugin?.id ?? plugin?.path ?? "plugin",
		type: "plugin",
		name: catalogEntry?.name ?? plugin?.name ?? "Plugin",
		tagline: catalogEntry?.tagline ?? "",
		description: catalogEntry?.description?.trim() || plugin?.description || "",
		tags: [...new Set(matchedEntries.flatMap((entry) => entry.tags))],
		install: catalogEntry?.install ?? { command: "", args: [] },
	};
	return {
		plugin,
		matchedEntries,
		catalogEntry,
		entry,
		/** Other matching entries whose setup the main entry does not cover. */
		supplementalSetupEntries: matchedEntries.filter(
			(entry) =>
				marketplaceEntryKey(entry) !==
					(catalogEntry ? marketplaceEntryKey(catalogEntry) : undefined) &&
				(entry.install.env?.length || entry.install.notes),
		),
	};
}

/** What a plugin adds, by kind, leaving out the kinds it does not use. */
function pluginContributionGroups(plugin: PluginItem, tools: ToolItem[]) {
	const contributions = plugin.contributions;
	return [
		{ label: "Skills", items: contributions?.skills ?? [] },
		{
			label: "Tools",
			items:
				contributions?.tools ??
				tools
					.filter(
						(tool) => tool.path === plugin.path && tool.source !== "builtin",
					)
					.map((tool) => tool.name)
					.sort((a, b) => a.localeCompare(b)),
		},
		{ label: "Rules", items: contributions?.rules ?? [] },
		{ label: "Hooks", items: contributions?.hooks ?? [] },
		{ label: "Commands", items: contributions?.commands ?? [] },
		{ label: "MCP servers", items: contributions?.mcpServers ?? [] },
		{ label: "Providers", items: contributions?.providers ?? [] },
	].filter((group) => group.items.length > 0);
}

function PluginContents({
	plugin,
	tools,
}: {
	plugin: PluginItem;
	tools: ToolItem[];
}) {
	const groups = pluginContributionGroups(plugin, tools);
	const inspection = plugin.contributions?.inspectionStatus;
	return (
		<section aria-label="Plugin contents" className="grid gap-4">
			<SectionHeading size="base" title="Includes" />
			{groups.length ? (
				<DetailList>
					{groups.map((group) => (
						<DetailListItem
							key={group.label}
							title={group.label}
							count={group.items.length}
							trailingText={
								<div className="flex flex-wrap @max-[30rem]/cline-ui-detail-list:justify-start justify-end gap-1">
									{group.items.map((item) => (
										<Badge
											key={item}
											className="max-w-full whitespace-normal break-all text-left"
											tone="neutral"
										>
											{item}
										</Badge>
									))}
								</div>
							}
						/>
					))}
				</DetailList>
			) : inspection === "available" ? (
				<p className="text-muted-foreground text-sm">
					No plugin contributions found.
				</p>
			) : inspection !== "disabled" ? (
				<p className="text-muted-foreground text-sm">
					Plugin contents are unavailable.
				</p>
			) : null}
			{inspection === "disabled" ? (
				<p className="text-muted-foreground text-sm">
					Enable this plugin to inspect its dynamic contributions.
				</p>
			) : null}
		</section>
	);
}

function InstalledPluginDetails({
	selection,
	onBack,
}: {
	selection: InstalledPluginSelection;
	onBack: (options?: { uninstalled: boolean }) => void;
}) {
	const {
		inventory,
		loading,
		error: inventoryError,
		refresh,
	} = useExtensionSection();
	const directory = useMarketplaceDirectory(refresh);
	const actions = useExtensionActions();
	const [uninstallOpen, setUninstallOpen] = useState(false);
	const mounted = useIsMounted();
	const returnedFromDetail = useRef(false);
	const catalogUninstallRequested = useRef(false);
	const toggleId = useId();

	const {
		plugin,
		matchedEntries,
		catalogEntry,
		entry,
		supplementalSetupEntries,
	} = resolvePluginSelection(selection, inventory.plugins, directory);
	const catalogState = catalogEntry
		? directory.actionStates.get(marketplaceEntryKey(catalogEntry))
		: undefined;
	const catalogBusy =
		catalogState?.status === "installing" ||
		catalogState?.status === "uninstalling";
	const installed = Boolean(
		plugin || directory.installedKeys.has(marketplaceEntryKey(entry)),
	);
	const readinessError =
		!plugin &&
		(directory.installedError || directory.errorMessage || inventoryError);
	const ready = Boolean(
		plugin ||
			(directory.installedReady && !loading && !readinessError && catalogEntry),
	);
	const action = plugin
		? actions.actions.get(extensionActionKey("plugin", plugin.path))
		: undefined;
	const pending = action?.pending ?? null;
	const error = action?.error;
	const busy = pending !== null || catalogBusy;
	const catalogMessage =
		catalogState && "message" in catalogState ? catalogState.message : null;
	const scope = plugin
		? (selection.scope ??
			(plugin.source === "workspace-plugin"
				? "Project"
				: getPathScope(plugin.path, inventory.workspaceRoot)))
		: undefined;

	useEffect(() => {
		if (catalogState?.status === "failed")
			catalogUninstallRequested.current = false;
		if (
			catalogUninstallRequested.current &&
			catalogState?.status === "uninstalled" &&
			!returnedFromDetail.current
		) {
			catalogUninstallRequested.current = false;
			returnedFromDetail.current = true;
			onBack({ uninstalled: true });
		}
	}, [catalogState, onBack]);
	useEffect(() => {
		if (
			selection.plugin &&
			!loading &&
			!inventoryError &&
			!inventory.plugins.some((item) => item.path === selection.plugin?.path) &&
			!returnedFromDetail.current
		) {
			returnedFromDetail.current = true;
			onBack({ uninstalled: true });
		}
	}, [inventory.plugins, inventoryError, loading, onBack, selection.plugin]);

	const togglePlugin = () => {
		if (plugin && plugin.toggleable !== false && !catalogBusy)
			void actions.togglePlugin(plugin);
	};
	const uninstallPlugin = async () => {
		if (!plugin || plugin.agentPlugin || catalogBusy) return;
		const result = await actions.uninstallPlugin(plugin, matchedEntries);
		if (result.status !== "succeeded") return;
		directory.removeInstalledKeys(matchedEntries.map(marketplaceEntryKey));
		if (mounted.current && !returnedFromDetail.current) {
			returnedFromDetail.current = true;
			onBack({ uninstalled: true });
		}
	};

	return (
		<MarketplaceEntryDetails
			entry={entry}
			installed={installed}
			onCategorySelected={onBack}
			tagLabels={directory.tagLabels}
			leadingActions={
				plugin ? (
					<label
						className="flex cursor-pointer items-center gap-3"
						htmlFor={toggleId}
					>
						<Switch
							id={toggleId}
							aria-label={`Enable ${plugin.name}`}
							checked={plugin.enabled}
							disabled={plugin.toggleable === false || busy}
							onCheckedChange={() => void togglePlugin()}
						/>
						<span className="text-sm">Enable</span>
						{pending === "toggle" ? <Spinner /> : null}
					</label>
				) : undefined
			}
			actions={
				plugin?.agentPlugin ? null : (
					<>
						<Button
							disabled={!ready || busy}
							onClick={() => {
								if (installed) setUninstallOpen(true);
								else if (catalogEntry && ready) {
									void directory.install(catalogEntry);
								}
							}}
							size="sm"
							tone={installed ? "destructive" : "neutral"}
							variant={installed ? "secondary" : "primary"}
							leadingIcon={installed ? Trash2 : undefined}
							loading={busy || (!ready && !readinessError)}
						>
							{pending === "uninstall"
								? "Uninstalling…"
								: entryActionLabel(
										catalogState,
										installed,
										ready || Boolean(readinessError),
									)}
						</Button>
						<CustomizationDeleteDialog
							open={uninstallOpen}
							type="plugin"
							name={entry.name}
							busy={!ready || busy || !installed}
							onClose={() => setUninstallOpen(false)}
							onConfirm={() => {
								if (!ready || busy || !installed) return;
								if (plugin) void uninstallPlugin();
								else if (catalogEntry) {
									catalogUninstallRequested.current = true;
									void directory.uninstall(catalogEntry);
								}
							}}
						/>
					</>
				)
			}
			feedback={
				<div className="grid gap-2 text-sm">
					{[
						...new Set(
							[error, plugin?.loadError, readinessError].filter(Boolean),
						),
					].map((message) => (
						<p key={String(message)} role="alert" className="text-error-text">
							{message}
						</p>
					))}
					{catalogMessage ? (
						<output
							role={catalogState?.status === "failed" ? "alert" : "status"}
							className={
								catalogState?.status === "failed"
									? "text-error-text"
									: "text-muted-foreground"
							}
						>
							{catalogMessage}
						</output>
					) : null}
				</div>
			}
			metadata={
				<>
					{plugin ? (
						<>
							<PluginContents plugin={plugin} tools={inventory.tools} />
							<DetailList aria-label="Installed plugin details">
								<DetailListItem title="Scope" trailingText={scope} />
								{!plugin.agentPlugin ? (
									<PathDetailListItem
										path={plugin.path}
										label="Plugin path"
										title="Path"
										trailingText={
											<span className="break-all">{plugin.path}</span>
										}
									/>
								) : null}
							</DetailList>
						</>
					) : null}
					{supplementalSetupEntries.map((supplementalEntry) => (
						<section
							key={marketplaceEntryKey(supplementalEntry)}
							aria-label={`${supplementalEntry.name} setup`}
							className="grid gap-4"
						>
							<SectionHeading
								size="base"
								title={`${supplementalEntry.name} setup`}
							/>
							<MarketplaceEntrySetupDetails entries={[supplementalEntry]} />
						</section>
					))}
				</>
			}
		/>
	);
}

export function InstalledPluginDetailPage({
	selection,
	backLabel = "Manage",
	onBack,
}: {
	selection: InstalledPluginSelection;
	backLabel?: string;
	onBack: (options?: { uninstalled: boolean }) => void;
}) {
	return (
		<CustomizationDetailPage
			backLabel={backLabel}
			onBack={onBack}
			navigationLabel="Plugin navigation"
		>
			<InstalledPluginDetails
				key={
					selection.plugin?.path ??
					selection.entry?.id ??
					selection.entries?.[0]?.id
				}
				selection={selection}
				onBack={onBack}
			/>
		</CustomizationDetailPage>
	);
}
