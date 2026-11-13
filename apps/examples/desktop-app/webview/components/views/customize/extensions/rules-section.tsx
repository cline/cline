import { ItemCard, Switch } from "@cline/ui";
import { FileText } from "lucide-react";
import { useCallback, useMemo } from "react";
import { PageCardGrid } from "../../shared/page-card-grid";
import { CustomizationEmptyState } from "../shared/customization-empty-state";
import {
	ExtensionSectionLayout,
	type ExtensionSectionProps,
	previewText,
	ScopeBadge,
} from "./extension-section-shared";
import { selectInstalledRules } from "./installed-inventory-selectors";
import type { RuleSelection } from "./rule-detail-page";
import { useExtensionSection } from "./use-extension-section";

export function RulesSection({
	onInventoryChanged,
	includeBuiltinItems = true,
	searchQuery,
	searchResults = false,
	onViewAll,
	previewLimit,
	itemOffset = 0,
	onOpenRule,
}: ExtensionSectionProps & {
	onOpenRule: (selection: RuleSelection, trigger?: HTMLButtonElement) => void;
}) {
	const {
		inventory,
		loading: isLoading,
		error: errorMessage,
		loadError,
		actionError,
		refresh,
	} = useExtensionSection(onInventoryChanged, includeBuiltinItems);
	const { workspaceRoot, rules, warnings } = inventory;
	const normalizedSearchQuery = (searchQuery ?? "").trim().toLowerCase();
	const scopedRules = useMemo(
		() =>
			selectInstalledRules(
				{ rules, workspaceRoot },
				{ searchQuery: normalizedSearchQuery, includeBuiltinItems },
			),
		[rules, workspaceRoot, normalizedSearchQuery, includeBuiltinItems],
	);
	const searchCount = scopedRules.length;
	const searchLoading = isLoading;
	const searchError = Boolean(errorMessage) || warnings.length > 0;
	const handleRefresh = useCallback(async () => {
		await refresh(true);
	}, [refresh]);
	const inventoryCount =
		isLoading || errorMessage || warnings.length > 0 ? undefined : rules.length;
	const content = (
		<ExtensionSectionLayout
			title="Rules"
			count={inventoryCount}
			loading={isLoading}
			loadError={loadError}
			actionError={actionError}
			warnings={warnings}
			searchResults={searchResults}
			onViewAll={onViewAll}
			onRefresh={handleRefresh}
		>
			<div>
				<div className="grid gap-3">
					{scopedRules.length > 0 && (
						<PageCardGrid>
							{scopedRules
								.slice(
									itemOffset,
									previewLimit === undefined
										? undefined
										: itemOffset + previewLimit,
								)
								.map(({ rule, scope }) => (
									<ItemCard
										key={rule.path}
										title={rule.name}
										icon={<FileText className="size-5" />}
										description={previewText(rule.instructions)}
										badges={<ScopeBadge scope={scope} />}
										primaryAction={{
											label: `View details for ${rule.name}`,
											onClick: (event) =>
												onOpenRule({ rule, scope }, event.currentTarget),
										}}
										actions={
											<Switch
												size="sm"
												tone="neutral"
												checked
												onCheckedChange={() => {}}
												disabled
												title="Toggling rules isn't supported yet"
												aria-label={`Enable ${rule.name}`}
											/>
										}
									/>
								))}
						</PageCardGrid>
					)}
					{!searchResults && scopedRules.length === 0 && (
						<CustomizationEmptyState itemLabel="rules" />
					)}
				</div>
			</div>
		</ExtensionSectionLayout>
	);
	if (searchResults && searchCount === 0 && !searchLoading && !searchError)
		return null;
	return content;
}
