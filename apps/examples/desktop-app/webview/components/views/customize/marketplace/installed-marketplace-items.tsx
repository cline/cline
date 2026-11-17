import {
	Badge,
	Banner,
	Button,
	Dialog,
	type EmptyStateAction,
	SectionHeading,
	Switch,
} from "@cline/ui";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import type {
	MarketplaceEntry,
	MarketplacePrimitiveType,
} from "@/lib/marketplace";
import { marketplaceEntryKey as entryKey } from "@/lib/marketplace-entry";
import type { EntryActionState } from "@/lib/use-marketplace-directory";
import { PageCardGrid } from "../../shared/page-card-grid";
import {
	CustomizationCategorySection,
	useCustomizationCategoryDialog,
} from "../shared/customization-category-section";
import { CustomizationDeleteDialog } from "../shared/customization-delete-dialog";
import { CustomizationDescription } from "../shared/customization-description";
import { CustomizationEmptyState } from "../shared/customization-empty-state";
import { CustomizationItemCard } from "../shared/customization-item-card";
import { CustomizationTypeBadge } from "../shared/customization-type-badge";
import type {
	MarketplaceLocalInstalledItem,
	MarketplaceLocalInstalledListItem,
} from "./installed-marketplace-types";
import { MarketplaceCard } from "./marketplace-card";
import {
	entryActionLabel,
	entryFailureStatus,
	isEntryActionBusy,
} from "./marketplace-entry-action";
import { MarketplaceSetupFeedback } from "./marketplace-entry-setup";
import { TYPE_META } from "./marketplace-type-meta";
import type { InstalledMarketplaceModel } from "./use-installed-marketplace-items";

function MarketplaceEntryCard({
	actionState,
	entry,
	installedStatusReady,
	onOpenMcp,
	onOpenSkill,
	onOpenPlugin,
	onOpenDetails,
	onUninstall,
}: {
	actionState: EntryActionState | undefined;
	entry: MarketplaceEntry;
	installedStatusReady: boolean;
	onOpenMcp?: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void;
	onOpenSkill?: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void;
	onOpenPlugin?: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void;
	onOpenDetails: (entry: MarketplaceEntry) => void;
	onUninstall: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void;
}) {
	const primaryRef = useRef<HTMLButtonElement>(null);
	const EntryIcon = TYPE_META[entry.type].icon;
	const busy = isEntryActionBusy(actionState);
	const failureStatus = entryFailureStatus(actionState);
	const openDetails =
		(entry.type === "skill"
			? onOpenSkill
			: entry.type === "mcp"
				? onOpenMcp
				: onOpenPlugin) ?? onOpenDetails;
	if (entry.type === "skill") {
		return (
			<MarketplaceCard
				entryKey={entryKey(entry)}
				name={entry.name}
				description={entry.tagline}
				authorName={entry.author?.name}
				meta={TYPE_META.skill}
				verified={entry.verified}
				installed
				status={failureStatus}
				selected={false}
				onSelect={(event) => openDetails(entry, event.currentTarget)}
				actions={
					<Switch
						checked
						disabled
						aria-label={`Enable ${entry.name}`}
						title="Enable or disable this skill once its local files are available."
					/>
				}
			/>
		);
	}
	return (
		<CustomizationItemCard
			title={entry.name}
			icon={EntryIcon}
			status={failureStatus}
			authorName={entry.author?.name}
			description={entry.description}
			badges={
				entry.type !== "plugin" ? (
					<Badge tone="neutral" className="shrink-0 text-muted-foreground">
						Marketplace
					</Badge>
				) : undefined
			}
			actions={
				<Button
					size="xs"
					variant="secondary"
					disabled={!installedStatusReady || busy}
					onClick={(event) =>
						onUninstall(entry, primaryRef.current ?? event.currentTarget)
					}
					tone="destructive"
					leadingIcon={Trash2}
					loading={busy || !installedStatusReady}
				>
					{entryActionLabel(actionState, true, installedStatusReady)}
				</Button>
			}
			primaryAction={{
				ref: primaryRef,
				onClick: (event) => openDetails(entry, event.currentTarget),
				label: `View ${entry.name} details`,
			}}
		/>
	);
}

function MarketplaceSection({
	actionStates,
	primitive,
	emptyQualifier,
	emptyAction,
	entries,
	groupSkillsAndWorkflows = false,
	installedStatusReady,
	localInstalledItems = [],
	renderLocalItem,
	onOpenMcp,
	onOpenSkill,
	onOpenPlugin,
	onOpenDetails,
	onUninstall,
	previewLimit,
	itemOffset = 0,
}: {
	actionStates: Map<string, EntryActionState>;
	primitive: MarketplacePrimitiveType;
	emptyQualifier?: string;
	emptyAction?: EmptyStateAction;
	entries: MarketplaceEntry[];
	groupSkillsAndWorkflows?: boolean;
	installedStatusReady: boolean;
	localInstalledItems?: MarketplaceLocalInstalledListItem[];
	renderLocalItem: (item: MarketplaceLocalInstalledListItem) => React.ReactNode;
	onOpenMcp?: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void;
	onOpenSkill?: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void;
	onOpenPlugin?: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void;
	onOpenDetails: (entry: MarketplaceEntry) => void;
	onUninstall: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void;
	previewLimit?: number;
	itemOffset?: number;
}) {
	const totalCount = entries.length + localInstalledItems.length;
	const groups = groupSkillsAndWorkflows
		? [
				{
					title: "Skills",
					items: localInstalledItems.filter(
						({ item }) => item.kind !== "workflow",
					),
					entries,
				},
				{
					title: "Workflows",
					items: localInstalledItems.filter(
						({ item }) => item.kind === "workflow",
					),
					entries: [],
				},
			]
		: [{ title: undefined, items: localInstalledItems, entries }];
	const hasMultipleGroups =
		groups.filter((group) => group.items.length + group.entries.length > 0)
			.length > 1;
	let remaining = previewLimit ?? totalCount;
	let skip = itemOffset;
	const visibleGroups = groups
		.map((group) => {
			const items = group.items.slice(skip, skip + remaining);
			skip = Math.max(0, skip - group.items.length);
			remaining -= items.length;
			const visibleEntries = group.entries.slice(skip, skip + remaining);
			skip = Math.max(0, skip - group.entries.length);
			remaining -= visibleEntries.length;
			return {
				...group,
				count: group.items.length + group.entries.length,
				items,
				entries: visibleEntries,
			};
		})
		.filter((group) => group.items.length + group.entries.length > 0);
	return (
		<section className="grid min-w-0 gap-3">
			{totalCount > 0 ? (
				<div className="grid gap-6">
					{visibleGroups.map((group) => (
						<div key={group.title ?? "all"} className="grid min-w-0 gap-3">
							{group.title && hasMultipleGroups ? (
								<SectionHeading
									title={group.title}
									count={group.count}
									headingLevel={4}
									size="base"
								/>
							) : null}
							<PageCardGrid>
								{group.items.map(renderLocalItem)}
								{group.entries.map((entry) => {
									const key = entryKey(entry);
									return (
										<MarketplaceEntryCard
											actionState={actionStates.get(key)}
											entry={entry}
											installedStatusReady={installedStatusReady}
											key={key}
											onOpenMcp={onOpenMcp}
											onOpenSkill={onOpenSkill}
											onOpenPlugin={onOpenPlugin}
											onOpenDetails={onOpenDetails}
											onUninstall={onUninstall}
										/>
									);
								})}
							</PageCardGrid>
						</div>
					))}
				</div>
			) : (
				<CustomizationEmptyState
					itemLabel={TYPE_META[primitive].noun}
					qualifier={emptyQualifier}
					marketplaceType={primitive}
					addAction={emptyAction}
				/>
			)}
		</section>
	);
}

type InstalledMarketplaceItemsProps = {
	model: InstalledMarketplaceModel;

	emptyAction?: EmptyStateAction;
	installedItems?: MarketplaceLocalInstalledItem[];
	onOpenMcp?: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void;
	onOpenSkill?: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void;
	onOpenPlugin?: (entry: MarketplaceEntry, trigger?: HTMLButtonElement) => void;
	primitive: MarketplacePrimitiveType;
	searchQuery?: string;
	searchResults?: boolean;
	previewLimit?: number;
	itemOffset?: number;
};

export function InstalledMarketplaceItems({
	model,
	emptyAction,
	installedItems,
	onOpenMcp,
	onOpenSkill,
	onOpenPlugin,
	primitive,
	searchQuery = "",
	searchResults = false,
	previewLimit,
	itemOffset,
}: InstalledMarketplaceItemsProps) {
	const {
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
	} = model;
	const renderers = new Map(
		installedItems?.map((item) => [item.key, item.render]),
	);
	const [detailEntry, setDetailEntry] = useState<MarketplaceEntry | null>(null);
	const [uninstallTarget, setUninstallTarget] = useState<{
		entry: MarketplaceEntry;
		trigger?: HTMLButtonElement;
	} | null>(null);
	const categoryDialog = useCustomizationCategoryDialog(() =>
		setDetailEntry(null),
	);
	const pendingUninstalls = useRef(
		new Map<
			string,
			{
				entry: MarketplaceEntry;
				trigger?: HTMLButtonElement;
				confirmation: Element | null;
				allowDetails: boolean;
			}
		>(),
	);
	useEffect(() => {
		const trackFocus = (event: FocusEvent) => {
			const target = event.target as Element | null;
			for (const pending of pendingUninstalls.current.values()) {
				// Confirmation closes asynchronously and restores the card's focus.
				if (
					!target ||
					target === document.body ||
					target === pending.trigger ||
					pending.confirmation?.contains(target)
				)
					continue;
				pending.allowDetails = false;
			}
		};
		document.addEventListener("focusin", trackFocus);
		return () => document.removeEventListener("focusin", trackFocus);
	}, []);
	useEffect(() => {
		for (const [
			key,
			{ entry, trigger, allowDetails },
		] of pendingUninstalls.current) {
			const state = actionStates.get(key);
			if (state?.status === "failed") {
				pendingUninstalls.current.delete(key);
				// An open detail already shows its own feedback. Otherwise, only
				// navigate while the user remains at the originating visible card.
				if (
					!detailEntry &&
					allowDetails &&
					trigger?.isConnected &&
					!trigger.closest("[hidden], [inert]")
				) {
					if (entry.type === "plugin" && onOpenPlugin)
						onOpenPlugin(entry, trigger);
					else setDetailEntry(entry);
				}
			} else if (state?.status === "uninstalled") {
				setDetailEntry((current) =>
					current && entryKey(current) === key ? null : current,
				);
				pendingUninstalls.current.delete(key);
			}
		}
	}, [actionStates, detailEntry, onOpenPlugin]);

	const uninstallEntry = (
		entry: MarketplaceEntry,
		trigger?: HTMLButtonElement,
	) => {
		const state = actionStates.get(entryKey(entry));
		if (
			!installedStatusReady ||
			isEntryActionBusy(state) ||
			pendingUninstalls.current.has(entryKey(entry))
		)
			return;
		pendingUninstalls.current.set(entryKey(entry), {
			entry,
			trigger,
			confirmation:
				document.activeElement?.closest('[role="alertdialog"]') ?? null,
			allowDetails: true,
		});
		void uninstall(entry);
	};
	const requestUninstall = (
		entry: MarketplaceEntry,
		trigger?: HTMLButtonElement,
	) => {
		// Keep confirmation's return target available when the action is disabled.
		trigger?.focus({ preventScroll: true });
		setUninstallTarget({ entry, trigger });
	};
	const openDetails = (
		entry: MarketplaceEntry,
		trigger?: HTMLButtonElement,
	) => {
		for (const pending of pendingUninstalls.current.values())
			pending.allowDetails = false;
		const open =
			entry.type === "mcp"
				? onOpenMcp
				: entry.type === "skill"
					? onOpenSkill
					: onOpenPlugin;
		if (open) open(entry, trigger);
		else setDetailEntry(entry);
	};
	const uninstallState = uninstallTarget
		? actionStates.get(entryKey(uninstallTarget.entry))
		: undefined;
	const detailActionState = detailEntry
		? actionStates.get(entryKey(detailEntry))
		: undefined;
	const detailBusy = detailActionState?.status === "uninstalling";
	return (
		<div className="grid min-w-0 gap-4">
			{errorMessage || installedError ? (
				<Banner tone="error">
					{errorMessage ?? "Unable to check installed marketplace entries."}
				</Banner>
			) : null}
			{!searchResults &&
			searchCount === 0 &&
			(loading || (catalog && !installedStatusReady)) ? (
				<div className="flex min-h-80 items-center justify-center rounded-lg border bg-card text-muted-foreground text-sm">
					<Spinner className="mr-2" />
					{loading ? "Loading marketplace…" : "Checking installed status…"}
				</div>
			) : null}
			{searchCount > 0 || (!searchResults && catalogResultsReady) ? (
				<MarketplaceSection
					previewLimit={previewLimit}
					itemOffset={itemOffset}
					actionStates={actionStates}
					primitive={primitive}
					emptyAction={emptyAction}
					emptyQualifier={
						searchQuery.trim()
							? `for "${searchQuery.trim()}"`
							: sharedCategory
								? `in ${sharedCategory.label}`
								: undefined
					}
					entries={catalogResultsReady ? installedEntries : []}
					groupSkillsAndWorkflows={!searchResults && primitive === "skill"}
					installedStatusReady={installedStatusReady}
					localInstalledItems={localInstalledItems}
					renderLocalItem={({ item, matchedEntries }) =>
						renderers.get(item.key)?.({ matchedEntries })
					}
					onOpenMcp={openDetails}
					onOpenSkill={openDetails}
					onOpenPlugin={openDetails}
					onOpenDetails={openDetails}
					onUninstall={requestUninstall}
				/>
			) : null}
			<Dialog
				open={detailEntry !== null}
				onCloseAutoFocus={categoryDialog.onCloseAutoFocus}
				onOpenChange={(open) => {
					if (!open) setDetailEntry(null);
				}}
				title={detailEntry?.name ?? "Customization details"}
				description={
					detailEntry?.description ? (
						<CustomizationDescription>
							{detailEntry.description}
						</CustomizationDescription>
					) : undefined
				}
				footer={
					detailEntry ? (
						<Button
							size="sm"
							tone="destructive"
							variant="secondary"
							disabled={detailBusy}
							onClick={() => requestUninstall(detailEntry)}
							leadingIcon={Trash2}
							loading={detailBusy}
						>
							{detailBusy ? "Uninstalling…" : "Uninstall"}
						</Button>
					) : undefined
				}
			>
				{detailEntry ? (
					<>
						<div className="flex flex-wrap gap-2">
							<CustomizationTypeBadge
								type={detailEntry.type}
								onSelected={categoryDialog.onSelected}
							/>
							{detailEntry.type === "plugin" ? (
								<Badge tone="neutral">Marketplace</Badge>
							) : null}
						</div>
						<CustomizationCategorySection
							categories={detailEntry.tags}
							tagLabels={tagLabels}
							onSelected={categoryDialog.onSelected}
						/>
						<MarketplaceSetupFeedback
							entry={detailEntry}
							actionState={detailActionState}
						/>
					</>
				) : null}
			</Dialog>
			<CustomizationDeleteDialog
				open={uninstallTarget !== null}
				type={uninstallTarget?.entry.type ?? primitive}
				name={uninstallTarget?.entry.name ?? "Customization"}
				busy={!installedStatusReady || isEntryActionBusy(uninstallState)}
				onClose={() => setUninstallTarget(null)}
				onConfirm={() => {
					if (uninstallTarget)
						uninstallEntry(uninstallTarget.entry, uninstallTarget.trigger);
				}}
			/>
		</div>
	);
}
