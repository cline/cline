import React, { useMemo, useState } from "react"
import { MarketplaceItem, TelemetryEventName } from "@roo-code/types"
import { vscode } from "@/utils/vscode"
import { telemetryClient } from "@/utils/TelemetryClient"
import { ViewState } from "../MarketplaceViewStateManager"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { isValidUrl } from "../../../utils/url"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { StandardTooltip } from "@/components/ui"
import { MarketplaceInstallModal } from "./MarketplaceInstallModal"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface ItemInstalledMetadata {
	type: string
}

interface MarketplaceItemCardProps {
	item: MarketplaceItem
	filters: ViewState["filters"]
	setFilters: (filters: Partial<ViewState["filters"]>) => void
	installed: {
		project: ItemInstalledMetadata | undefined
		global: ItemInstalledMetadata | undefined
	}
}

export const MarketplaceItemCard: React.FC<MarketplaceItemCardProps> = ({ item, filters, setFilters, installed }) => {
	const { t } = useAppTranslation()
	const { cwd } = useExtensionState()
	const [showInstallModal, setShowInstallModal] = useState(false)

	const typeLabel = useMemo(() => {
		const labels: Partial<Record<MarketplaceItem["type"], string>> = {
			mode: t("marketplace:filters.type.mode"),
			mcp: t("marketplace:filters.type.mcpServer"),
		}
		return labels[item.type] ?? "N/A"
	}, [item.type, t])

	// Determine installation status
	const isInstalledGlobally = !!installed.global
	const isInstalledInProject = !!installed.project
	const isInstalled = isInstalledGlobally || isInstalledInProject

	const handleInstallClick = () => {
		// Send telemetry for install button click
		telemetryClient.capture(TelemetryEventName.MARKETPLACE_INSTALL_BUTTON_CLICKED, {
			itemId: item.id,
			itemType: item.type,
			itemName: item.name,
		})

		// Show modal for all item types (MCP and modes)
		setShowInstallModal(true)
	}

	return (
		<>
			<div className="border border-vscode-panel-border rounded-sm p-3 bg-vscode-editor-background">
				<div className="flex gap-2 items-start justify-between">
					<div className="flex gap-2 items-start">
						<div>
							<h3 className="text-lg font-semibold text-vscode-foreground mt-0 mb-1 leading-none">
								{item.type === "mcp" && item.url && isValidUrl(item.url) ? (
									<Button
										variant="link"
										className="p-0 h-auto text-lg font-semibold text-vscode-foreground hover:underline"
										onClick={() => vscode.postMessage({ type: "openExternal", url: item.url })}>
										{item.name}
									</Button>
								) : (
									item.name
								)}
							</h3>
							<AuthorInfo item={item} typeLabel={typeLabel} />
						</div>
					</div>
					<div className="flex items-center gap-1">
						{isInstalled ? (
							/* Single Remove button when installed */
							<StandardTooltip
								content={
									isInstalledInProject
										? t("marketplace:items.card.removeProjectTooltip")
										: t("marketplace:items.card.removeGlobalTooltip")
								}>
								<Button
									size="sm"
									variant="secondary"
									className="text-xs h-5 py-0 px-2"
									onClick={() => {
										// Determine which installation to remove (prefer project over global)
										const target = isInstalledInProject ? "project" : "global"
										vscode.postMessage({
											type: "removeInstalledMarketplaceItem",
											mpItem: item,
											mpInstallOptions: { target },
										})

										// Request fresh marketplace data to update installed status
										vscode.postMessage({
											type: "fetchMarketplaceData",
										})
									}}>
									{t("marketplace:items.card.remove")}
								</Button>
							</StandardTooltip>
						) : (
							/* Single Install button when not installed */
							<Button
								size="sm"
								variant="default"
								className="text-xs h-5 py-0 px-2"
								onClick={handleInstallClick}>
								{t("marketplace:items.card.install")}
							</Button>
						)}
					</div>
				</div>

				<p className="my-2 text-vscode-foreground">{item.description}</p>

				{/* Installation status badges and tags in the same row */}
				{(isInstalled || (item.tags && item.tags.length > 0)) && (
					<div className="relative flex flex-wrap gap-1 my-2">
						{/* Installation status badge on the left */}
						{isInstalled && (
							<span className="text-xs px-2 py-0.5 rounded-sm h-5 flex items-center bg-green-600/20 text-green-400 border border-green-600/30 shrink-0">
								{t("marketplace:items.card.installed")}
							</span>
						)}

						{/* Tags on the right */}
						{item.tags &&
							item.tags.length > 0 &&
							item.tags.map((tag) => (
								<StandardTooltip
									key={tag}
									content={
										filters.tags.includes(tag)
											? t("marketplace:filters.tags.clear", { count: tag })
											: t("marketplace:filters.tags.clickToFilter")
									}>
									<Button
										size="sm"
										variant="secondary"
										className={cn("rounded-sm capitalize text-xs px-2 h-5", {
											"border-solid border-primary text-primary": filters.tags.includes(tag),
										})}
										onClick={() => {
											const newTags = filters.tags.includes(tag)
												? filters.tags.filter((t: string) => t !== tag)
												: [...filters.tags, tag]
											setFilters({ tags: newTags })
										}}>
										{tag}
									</Button>
								</StandardTooltip>
							))}
					</div>
				)}
			</div>

			{/* Installation Modal - Outside the clickable card */}
			<MarketplaceInstallModal
				item={item}
				isOpen={showInstallModal}
				onClose={() => setShowInstallModal(false)}
				hasWorkspace={!!cwd}
			/>
		</>
	)
}

interface AuthorInfoProps {
	item: MarketplaceItem
	typeLabel: string
}

const AuthorInfo: React.FC<AuthorInfoProps> = ({ item, typeLabel }) => {
	const { t } = useAppTranslation()

	const handleOpenAuthorUrl = () => {
		if (item.authorUrl && isValidUrl(item.authorUrl)) {
			vscode.postMessage({ type: "openExternal", url: item.authorUrl })
		}
	}

	if (item.author) {
		return (
			<p className="text-sm text-vscode-descriptionForeground my-0">
				{typeLabel}{" "}
				{item.authorUrl && isValidUrl(item.authorUrl) ? (
					<Button
						variant="link"
						className="p-0 h-auto text-sm text-vscode-textLink hover:underline"
						onClick={handleOpenAuthorUrl}>
						{t("marketplace:items.card.by", { author: item.author })}
					</Button>
				) : (
					t("marketplace:items.card.by", { author: item.author })
				)}
			</p>
		)
	}
	return null
}
