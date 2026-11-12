import { SectionHeading, Switch } from "@cline/ui";
import { Wrench } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import type {
	ToolItem,
	UserInstructionListsResponse,
} from "@/lib/extension-inventory";
import { PageCardGrid } from "../../shared/page-card-grid";
import { CustomizationEmptyState } from "../shared/customization-empty-state";
import { CustomizationItemCard } from "../shared/customization-item-card";
import { usePrimaryButtonRefs } from "../shared/use-primary-button-refs";
import {
	ExtensionSectionLayout,
	type ExtensionSectionProps,
} from "./extension-section-shared";
import { selectInstalledTools } from "./installed-inventory-selectors";
import { ToolDetailsDialog } from "./tool-details-dialog";
import { useExtensionSection } from "./use-extension-section";

/** One source of tools: its heading, an "Enable all" switch and its cards. */
function ToolGroup({
	id,
	title,
	noun,
	tools,
	visibleTools,
	hidden,
	busy,
	onSetAllEnabled,
	renderCard,
}: {
	id: string;
	title: string;
	/** Lower-case plural for labels and the empty state, e.g. "plugin tools". */
	noun: string;
	/** Every tool in the group that matches the search. */
	tools: ToolItem[];
	/** The part of `tools` on the current page. */
	visibleTools: ToolItem[];
	hidden: boolean;
	busy: boolean;
	onSetAllEnabled: (enabled: boolean) => void;
	renderCard: (tool: ToolItem) => ReactNode;
}) {
	const allEnabled = tools.length > 0 && tools.every((tool) => tool.enabled);
	const toggleId = `${id}-tools-toggle-all`;
	return (
		<div className="grid gap-5" hidden={hidden}>
			<SectionHeading
				title={title}
				count={tools.length}
				size="base"
				headingLevel={4}
				actions={
					tools.length > 0 && (
						<div className="flex items-center gap-4 text-muted-foreground text-sm">
							<label className="cursor-pointer" htmlFor={toggleId}>
								Enable all
							</label>
							<Switch
								size="sm"
								tone="neutral"
								checked={allEnabled}
								onCheckedChange={onSetAllEnabled}
								disabled={busy}
								id={toggleId}
								aria-label={`${allEnabled ? "Disable" : "Enable"} all ${noun}`}
							/>
						</div>
					)
				}
			/>
			{visibleTools.length > 0 ? (
				<PageCardGrid>{visibleTools.map(renderCard)}</PageCardGrid>
			) : null}
			{tools.length === 0 ? <CustomizationEmptyState itemLabel={noun} /> : null}
		</div>
	);
}

export function ToolsSection({
	onInventoryChanged,
	searchQuery,
	searchResults = false,
	onViewAll,
	previewLimit,
	itemOffset = 0,
	onOpenModelProviders,
	includeBuiltinItems = true,
}: ExtensionSectionProps & {
	onOpenModelProviders?: () => void;
}) {
	const cardReturnFocusRef = useRef<HTMLButtonElement | null>(null);
	const primaryButtons = usePrimaryButtonRefs();
	const restoreCardFocus = (event: Event) => {
		if (cardReturnFocusRef.current?.isConnected) {
			event.preventDefault();
			cardReturnFocusRef.current.focus({ preventScroll: true });
		}
	};
	const {
		inventory,
		loading: isLoading,
		error: errorMessage,
		loadError,
		actionError,
		setError: setErrorMessage,
		refresh,
		applyResponse,
	} = useExtensionSection(onInventoryChanged, includeBuiltinItems);
	const { tools, warnings } = inventory;
	const [togglingToolIds, setTogglingToolIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [toolToggleError, setToolToggleError] = useState<{
		toolId: string;
		message: string;
	} | null>(null);
	const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
	const selectedTool = tools.find((tool) => tool.id === selectedToolId);
	const setToolEnabled = useCallback(
		async (tool: ToolItem) => {
			setTogglingToolIds((current) => new Set(current).add(tool.id));
			setToolToggleError(null);
			setErrorMessage(null);
			try {
				const names = [tool.name, ...(tool.headlessToolNames ?? [])].filter(
					Boolean,
				);
				if (names.length === 0) {
					throw new Error("tool name is required");
				}
				const response =
					await desktopClient.invoke<UserInstructionListsResponse>(
						"set_tool_disabled",
						{ names, disabled: tool.enabled },
					);
				applyResponse(response);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setToolToggleError({ toolId: tool.id, message });
				setErrorMessage(message);
			} finally {
				setTogglingToolIds((current) => {
					const next = new Set(current);
					next.delete(tool.id);
					return next;
				});
			}
		},
		[applyResponse, setErrorMessage],
	);
	const setAllToolsEnabled = useCallback(
		async (toolsList: ToolItem[], enabled: boolean) => {
			const targets = toolsList.filter((tool) => !enabled || !tool.enabled);
			if (targets.length === 0) {
				return;
			}
			const targetIds = targets.map((tool) => tool.id);
			setTogglingToolIds((current) => {
				const next = new Set(current);
				for (const id of targetIds) {
					next.add(id);
				}
				return next;
			});
			setErrorMessage(null);
			try {
				const names = targets.flatMap((tool) =>
					[tool.name, ...(tool.headlessToolNames ?? [])].filter(Boolean),
				);
				if (names.length === 0) {
					throw new Error("tool name is required");
				}
				const response =
					await desktopClient.invoke<UserInstructionListsResponse>(
						"set_tool_disabled",
						{ names, disabled: !enabled },
					);
				applyResponse(response);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setErrorMessage(message);
			} finally {
				setTogglingToolIds((current) => {
					const next = new Set(current);
					for (const id of targetIds) {
						next.delete(id);
					}
					return next;
				});
			}
		},
		[applyResponse, setErrorMessage],
	);
	const {
		builtinTools,
		pluginTools,
		filteredBuiltinTools,
		filteredPluginTools,
	} = useMemo(
		() => selectInstalledTools({ tools }, { searchQuery, includeBuiltinItems }),
		[tools, searchQuery, includeBuiltinItems],
	);
	const visibleBuiltinTools = filteredBuiltinTools.slice(
		itemOffset,
		previewLimit === undefined ? undefined : itemOffset + previewLimit,
	);
	const pluginOffset = Math.max(0, itemOffset - filteredBuiltinTools.length);
	const visiblePluginTools = filteredPluginTools.slice(
		pluginOffset,
		previewLimit === undefined
			? undefined
			: pluginOffset + Math.max(0, previewLimit - visibleBuiltinTools.length),
	);
	const searchCount = filteredBuiltinTools.length + filteredPluginTools.length;
	const searchLoading = isLoading;
	const searchError = Boolean(errorMessage) || warnings.length > 0;
	const renderToolCard = (tool: ToolItem) => (
		<CustomizationItemCard
			key={tool.id}
			onClickCapture={() => {
				cardReturnFocusRef.current = primaryButtons.get(tool.id) ?? null;
			}}
			title={tool.name}
			status={
				toolToggleError?.toolId === tool.id && !togglingToolIds.has(tool.id)
					? "action-failed"
					: undefined
			}
			count={
				(tool.headlessToolNames?.length ?? 0) > 1
					? tool.headlessToolNames?.length
					: undefined
			}
			icon={Wrench}
			description={tool.description?.trim() || "No description available."}
			primaryAction={{
				ref: primaryButtons.ref(tool.id),
				label: `View details for ${tool.name}`,
				onClick: () => setSelectedToolId(tool.id),
			}}
			actions={
				<Switch
					size="sm"
					tone="neutral"
					checked={tool.enabled}
					onCheckedChange={() => {
						void setToolEnabled(tool);
					}}
					disabled={togglingToolIds.has(tool.id)}
					aria-label={`Enable ${tool.name}`}
				/>
			}
		/>
	);
	const handleRefresh = useCallback(async () => {
		await refresh(true);
	}, [refresh]);
	const inventoryCount =
		isLoading || errorMessage || warnings.length > 0
			? undefined
			: builtinTools.length + pluginTools.length;
	const toolGroups = [
		{
			id: "builtin",
			title: "Built-in tools",
			noun: "built-in tools",
			tools: filteredBuiltinTools,
			visibleTools: visibleBuiltinTools,
			hidden: !includeBuiltinItems,
		},
		{
			id: "plugin",
			title: "Plugin tools",
			noun: "plugin tools",
			tools: filteredPluginTools,
			visibleTools: visiblePluginTools,
			hidden: false,
		},
	];
	const content = (
		<ExtensionSectionLayout
			title="Tools"
			count={inventoryCount}
			loading={isLoading}
			loadError={loadError}
			actionError={actionError}
			warnings={warnings}
			searchResults={searchResults}
			onViewAll={onViewAll}
			onRefresh={handleRefresh}
		>
			{searchResults ? (
				<PageCardGrid>
					{visibleBuiltinTools.map(renderToolCard)}
					{visiblePluginTools.map(renderToolCard)}
				</PageCardGrid>
			) : (
				<div className="grid gap-6">
					{toolGroups.map((group) => (
						<ToolGroup
							key={group.id}
							{...group}
							// A preview shows whichever groups have cards, unless nothing matches at all.
							hidden={
								group.hidden ||
								(previewLimit !== undefined &&
									searchCount > 0 &&
									group.visibleTools.length === 0)
							}
							busy={group.tools.some((tool) => togglingToolIds.has(tool.id))}
							onSetAllEnabled={(enabled) =>
								void setAllToolsEnabled(group.tools, enabled)
							}
							renderCard={renderToolCard}
						/>
					))}
				</div>
			)}
			<ToolDetailsDialog
				tool={selectedTool}
				busy={Boolean(selectedTool && togglingToolIds.has(selectedTool.id))}
				error={
					toolToggleError?.toolId === selectedTool?.id
						? toolToggleError?.message
						: undefined
				}
				onClose={() => setSelectedToolId(null)}
				onRestoreFocus={restoreCardFocus}
				onToggle={setToolEnabled}
				onOpenModelProviders={onOpenModelProviders}
			/>
		</ExtensionSectionLayout>
	);
	if (searchResults && searchCount === 0 && !searchLoading && !searchError)
		return null;
	return content;
}
