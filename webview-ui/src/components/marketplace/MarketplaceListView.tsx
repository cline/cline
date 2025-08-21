import * as React from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { X, ChevronsUpDown } from "lucide-react"
import { MarketplaceItemCard } from "./components/MarketplaceItemCard"
import { MarketplaceViewStateManager } from "./MarketplaceViewStateManager"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useStateManager } from "./useStateManager"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { IssueFooter } from "./IssueFooter"

export interface MarketplaceListViewProps {
	stateManager: MarketplaceViewStateManager
	allTags: string[]
	filteredTags: string[]
	filterByType?: "mcp" | "mode"
}

export function MarketplaceListView({ stateManager, allTags, filteredTags, filterByType }: MarketplaceListViewProps) {
	const [state, manager] = useStateManager(stateManager)
	const { t } = useAppTranslation()
	const { marketplaceInstalledMetadata, cloudUserInfo } = useExtensionState()
	const [isTagPopoverOpen, setIsTagPopoverOpen] = React.useState(false)
	const [tagSearch, setTagSearch] = React.useState("")
	const allItems = state.displayItems || []
	const organizationMcps = state.displayOrganizationMcps || []

	// NOTE: installed metadata is already synchronized into the state manager via handleMessage("state"/"marketplaceData")
	// in MarketplaceViewStateManager; avoid dispatching UPDATE_FILTERS here to prevent render loops.

	// Filter items by type if specified
	const items = filterByType ? allItems.filter((item) => item.type === filterByType) : allItems
	const orgMcps = filterByType === "mcp" ? organizationMcps : []

	const isEmpty = items.length === 0 && orgMcps.length === 0

	return (
		<>
			<div className="mb-4">
				<div className="relative">
					<Input
						type="text"
						placeholder={
							filterByType === "mcp"
								? t("marketplace:filters.search.placeholderMcp")
								: filterByType === "mode"
									? t("marketplace:filters.search.placeholderMode")
									: t("marketplace:filters.search.placeholder")
						}
						value={state.filters.search}
						onChange={(e) =>
							manager.transition({
								type: "UPDATE_FILTERS",
								payload: { filters: { search: e.target.value } },
							})
						}
					/>
				</div>
				<div className="mt-2 flex gap-2">
					<Select
						value={state.filters.installed}
						onValueChange={(value: "all" | "installed" | "not_installed") =>
							manager.transition({
								type: "UPDATE_FILTERS",
								payload: { filters: { installed: value } },
							})
						}>
						<SelectTrigger className="flex-1 h-7">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">{t("marketplace:filters.installed.all")}</SelectItem>
							<SelectItem value="installed">{t("marketplace:filters.installed.installed")}</SelectItem>
							<SelectItem value="not_installed">
								{t("marketplace:filters.installed.notInstalled")}
							</SelectItem>
						</SelectContent>
					</Select>
					{allTags.length > 0 && (
						<div className="flex-1">
							<Popover open={isTagPopoverOpen} onOpenChange={(open) => setIsTagPopoverOpen(open)}>
								<PopoverTrigger asChild>
									<Button
										variant="combobox"
										role="combobox"
										aria-expanded={isTagPopoverOpen}
										className="w-full justify-between h-7">
										<span className="truncate">
											{state.filters.tags.length > 0
												? state.filters.tags
														.map((t: string) => t.charAt(0).toUpperCase() + t.slice(1))
														.join(", ")
												: t("marketplace:filters.tags.label")}
										</span>
										<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
									</Button>
								</PopoverTrigger>
								<PopoverContent
									className="w-[var(--radix-popover-trigger-width)] p-0"
									onClick={(e) => e.stopPropagation()}>
									<Command>
										<div className="relative">
											<CommandInput
												className="h-9 pr-8"
												placeholder={t("marketplace:filters.tags.placeholder")}
												value={tagSearch}
												onValueChange={setTagSearch}
											/>
											{tagSearch && (
												<Button
													variant="ghost"
													size="icon"
													className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7"
													onClick={() => setTagSearch("")}>
													<X className="h-4 w-4" />
												</Button>
											)}
										</div>
										<CommandList className="max-h-[200px] overflow-y-auto bg-vscode-dropdown-background divide-y divide-vscode-panel-border">
											<CommandEmpty className="p-2 text-sm text-vscode-descriptionForeground">
												{t("marketplace:filters.tags.noResults")}
											</CommandEmpty>
											<CommandGroup>
												{filteredTags.map((tag: string) => (
													<CommandItem
														key={tag}
														value={tag}
														onSelect={() => {
															const isSelected = state.filters.tags.includes(tag)
															manager.transition({
																type: "UPDATE_FILTERS",
																payload: {
																	filters: {
																		tags: isSelected
																			? state.filters.tags.filter(
																					(t) => t !== tag,
																				)
																			: [...state.filters.tags, tag],
																	},
																},
															})
														}}
														data-selected={state.filters.tags.includes(tag)}
														className="grid grid-cols-[1rem_1fr] gap-2 cursor-pointer text-sm capitalize"
														onMouseDown={(e) => {
															e.stopPropagation()
															e.preventDefault()
														}}>
														{state.filters.tags.includes(tag) ? (
															<span className="codicon codicon-check" />
														) : (
															<span />
														)}
														{tag}
													</CommandItem>
												))}
											</CommandGroup>
										</CommandList>
									</Command>
								</PopoverContent>
							</Popover>
						</div>
					)}
				</div>
				{state.filters.tags.length > 0 && (
					<div className="text-xs text-vscode-descriptionForeground mt-2 flex items-center justify-between">
						<div className="flex items-center">
							<span className="codicon codicon-tag mr-1"></span>
							{t("marketplace:filters.tags.selected")}
						</div>
						<Button
							className="shadow-none font-normal flex items-center gap-1 h-auto py-0.5 px-1.5 text-xs"
							size="sm"
							variant="secondary"
							onClick={(e) => {
								e.stopPropagation()
								manager.transition({
									type: "UPDATE_FILTERS",
									payload: { filters: { tags: [] } },
								})
							}}>
							<span className="codicon codicon-close"></span>
							{t("marketplace:filters.tags.clear")}
						</Button>
					</div>
				)}
			</div>

			{state.isFetching && isEmpty && (
				<div className="flex flex-col items-center justify-center h-64 text-vscode-descriptionForeground animate-fade-in">
					<div className="animate-spin mb-4">
						<span className="codicon codicon-sync text-3xl"></span>
					</div>
					<p>{t("marketplace:items.refresh.refreshing")}</p>
					<p className="text-sm mt-2 animate-pulse">{t("marketplace:items.refresh.mayTakeMoment")}</p>
				</div>
			)}

			{!state.isFetching && isEmpty && (
				<div className="flex flex-col items-center justify-center h-64 text-vscode-descriptionForeground animate-fade-in">
					<span className="codicon codicon-inbox text-4xl mb-4 opacity-70"></span>
					<p className="font-medium">{t("marketplace:items.empty.noItems")}</p>
					<p className="text-sm mt-2">{t("marketplace:items.empty.adjustFilters")}</p>
					<Button
						onClick={() =>
							manager.transition({
								type: "UPDATE_FILTERS",
								payload: { filters: { search: "", type: "", tags: [], installed: "all" } },
							})
						}
						className="mt-4 bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground transition-colors">
						<span className="codicon codicon-clear-all mr-2"></span>
						{t("marketplace:items.empty.clearAllFilters")}
					</Button>
				</div>
			)}

			{!state.isFetching && !isEmpty && (
				<div className="pb-3">
					{orgMcps.length > 0 && (
						<div className="mb-6">
							<div className="flex items-center gap-2 mb-3 px-1">
								<span className="codicon codicon-organization text-lg"></span>
								<h3 className="text-sm font-semibold text-vscode-foreground">
									{t("marketplace:sections.organizationMcps", {
										organization: cloudUserInfo?.organizationName,
									})}
								</h3>
								<div className="flex-1 h-px bg-vscode-input-border"></div>
							</div>
							<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
								{orgMcps.map((item) => (
									<MarketplaceItemCard
										key={`org-${item.id}`}
										item={item}
										filters={state.filters}
										setFilters={(filters) =>
											manager.transition({
												type: "UPDATE_FILTERS",
												payload: { filters },
											})
										}
										installed={{
											project: marketplaceInstalledMetadata?.project?.[item.id],
											global: marketplaceInstalledMetadata?.global?.[item.id],
										}}
									/>
								))}
							</div>
						</div>
					)}

					{items.length > 0 && (
						<div>
							{orgMcps.length > 0 && (
								<div className="flex items-center gap-2 mb-3 px-1">
									<span className="codicon codicon-globe text-lg"></span>
									<h3 className="text-sm font-semibold text-vscode-foreground">
										{t("marketplace:sections.marketplace")}
									</h3>
									<div className="flex-1 h-px bg-vscode-input-border"></div>
								</div>
							)}
							<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
								{items.map((item) => (
									<MarketplaceItemCard
										key={item.id}
										item={item}
										filters={state.filters}
										setFilters={(filters) =>
											manager.transition({
												type: "UPDATE_FILTERS",
												payload: { filters },
											})
										}
										installed={{
											project: marketplaceInstalledMetadata?.project?.[item.id],
											global: marketplaceInstalledMetadata?.global?.[item.id],
										}}
									/>
								))}
							</div>
						</div>
					)}
				</div>
			)}

			<IssueFooter />
		</>
	)
}
