import { Badge, ItemCard, Switch } from "@cline/ui";
import { Play } from "lucide-react";
import { useCallback, useMemo } from "react";
import {
	extensionActionKey,
	useExtensionActions,
} from "@/lib/use-extension-actions";
import { InstalledMarketplaceItems } from "../marketplace/installed-marketplace-items";
import type {
	MarketplaceLocalInstalledItem,
	MarketplaceLocalInstalledItemRenderContext,
} from "../marketplace/installed-marketplace-types";
import { MarketplaceCard } from "../marketplace/marketplace-card";
import { TYPE_META } from "../marketplace/marketplace-type-meta";
import type { InstalledMarketplaceModel } from "../marketplace/use-installed-marketplace-items";
import {
	type CommandItem,
	ExtensionSectionLayout,
	type ExtensionSectionProps,
	previewText,
	ScopeBadge,
} from "./extension-section-shared";
import {
	getInstalledCommands,
	skillMarketplaceItem,
} from "./installed-marketplace-selectors";
import type { InstalledSkillSelection } from "./installed-skill-detail";
import { useExtensionSection } from "./use-extension-section";
import type { WorkflowSelection } from "./workflow-detail-page";

type SkillsSectionProps = ExtensionSectionProps & {
	marketplaceModel: InstalledMarketplaceModel;
	onOpenSkill: (
		selection: InstalledSkillSelection,
		trigger?: HTMLButtonElement,
	) => void;
	onOpenWorkflow: (
		selection: WorkflowSelection,
		trigger?: HTMLButtonElement,
	) => void;
};

export function SkillsSection({
	marketplaceModel,
	onInventoryChanged,
	includeBuiltinItems,
	searchQuery,
	searchResults = false,
	onViewAll,
	previewLimit,
	itemOffset,
	onOpenSkill,
	onOpenWorkflow,
}: SkillsSectionProps) {
	const state = useExtensionSection(onInventoryChanged, includeBuiltinItems);
	const commandItems = useMemo(
		() => getInstalledCommands(state.inventory),
		[state.inventory],
	);
	const { inventory, loading: isLoading, error: errorMessage, refresh } = state;
	const { skills, warnings } = inventory;
	const { actions, toggleSkill } = useExtensionActions();
	const setSkillEnabled = async (skill: CommandItem) => {
		if (skill.agentPlugin) return;
		const result = await toggleSkill(skill);
		if (result.status === "succeeded") onInventoryChanged?.();
	};
	const summary = {
		...marketplaceModel.summary,
		loading: isLoading || marketplaceModel.summary.loading,
		error:
			Boolean(errorMessage) ||
			warnings.length > 0 ||
			marketplaceModel.summary.error,
	};
	const renderSkillCard = (
		item: CommandItem,
		context?: MarketplaceLocalInstalledItemRenderContext,
	) => {
		const key = `${item.type}:${item.path}`;
		const matchedSkill = context?.matchedEntries?.find(
			(entry) => entry.type === "skill",
		);
		const authorName =
			item.type === "skill" ? matchedSkill?.author?.name.trim() : undefined;
		if (item.type === "skill") {
			const name = matchedSkill?.name ?? item.name;
			return (
				<MarketplaceCard
					key={key}
					entryKey={matchedSkill ? `skill:${matchedSkill.id}` : key}
					name={name}
					description={
						matchedSkill?.tagline ??
						(item.description?.trim() || previewText(item.instructions))
					}
					authorName={authorName}
					meta={TYPE_META.skill}
					verified={matchedSkill?.verified}
					installed
					status={
						actions.get(extensionActionKey("skill", item.path))?.error
							? "action-failed"
							: undefined
					}
					selected={false}
					onSelect={(event) =>
						onOpenSkill(
							{ skill: item, entry: matchedSkill },
							event.currentTarget,
						)
					}
					actions={
						<Switch
							size="sm"
							tone="neutral"
							checked={item.enabled !== false}
							onCheckedChange={() => void setSkillEnabled(item)}
							disabled={
								item.agentPlugin === true ||
								Boolean(
									actions.get(extensionActionKey("skill", item.path))?.pending,
								)
							}
							title={
								item.agentPlugin ? "Managed by the installed plugin" : undefined
							}
							aria-label={`Enable ${name}`}
						/>
					}
				/>
			);
		}
		return (
			<ItemCard
				key={key}
				title={item.name}
				icon={<Play className="size-5" />}
				description={item.description?.trim() || previewText(item.instructions)}
				primaryAction={{
					label: `View ${item.name} details`,
					onClick: (event) =>
						onOpenWorkflow(
							{ workflow: item, entries: context?.matchedEntries ?? [] },
							event.currentTarget,
						),
				}}
				badges={
					<>
						<ScopeBadge scope={item.scope} />
						{item.agentPlugin === true ? (
							<Badge tone="neutral">Agent Plugin</Badge>
						) : null}
						{context?.matchedEntries?.length ? (
							<Badge tone="neutral">Marketplace</Badge>
						) : null}
					</>
				}
				actions={
					<Switch
						size="sm"
						tone="neutral"
						checked={item.enabled !== false}
						disabled
						title="Toggling workflows isn't supported yet"
						aria-label={`Enable ${item.name}`}
					/>
				}
			/>
		);
	};
	const installedCatalogLocalItems = commandItems.map(
		(item): MarketplaceLocalInstalledItem => ({
			...skillMarketplaceItem(item),
			render: (context) => renderSkillCard(item, context),
		}),
	);
	const handleRefresh = useCallback(async () => {
		await refresh(true);
	}, [refresh]);
	const inventoryCount =
		summary.loading || summary.error ? undefined : summary.count;
	return (
		<ExtensionSectionLayout
			title="Skills"
			count={inventoryCount}
			loading={isLoading}
			loadError={state.loadError}
			actionError={
				state.actionError ??
				skills
					.map(
						(skill) =>
							actions.get(extensionActionKey("skill", skill.path))?.error,
					)
					.find(Boolean)
			}
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
				onOpenSkill={(entry, trigger) => onOpenSkill({ entry }, trigger)}
				primitive="skill"
				searchQuery={searchQuery}
				searchResults={searchResults}
				showInstalledHeading={false}
			/>
		</ExtensionSectionLayout>
	);
}
