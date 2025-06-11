import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Tab, TabContent, TabHeader } from "../common/Tab"
import { MarketplaceViewStateManager } from "./MarketplaceViewStateManager"
import { useStateManager } from "./useStateManager"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import { MarketplaceListView } from "./MarketplaceListView"
import { cn } from "@/lib/utils"
import { TooltipProvider } from "@/components/ui/tooltip"

interface MarketplaceViewProps {
	onDone?: () => void
	stateManager: MarketplaceViewStateManager
}
export function MarketplaceView({ stateManager, onDone }: MarketplaceViewProps) {
	const { t } = useAppTranslation()
	const [state, manager] = useStateManager(stateManager)
	const [hasReceivedInitialState, setHasReceivedInitialState] = useState(false)

	// Track when we receive the initial state
	useEffect(() => {
		// Check if we already have items (state might have been received before mount)
		if (state.allItems.length > 0 && !hasReceivedInitialState) {
			setHasReceivedInitialState(true)
		}
	}, [state.allItems, hasReceivedInitialState])

	// Ensure marketplace state manager processes messages when component mounts
	useEffect(() => {
		// When the marketplace view first mounts, we need to trigger a state update
		// to ensure we get the current marketplace items. We do this by sending
		// a filter message with empty filters, which will cause the extension to
		// send back the full state including all marketplace items.
		if (!hasReceivedInitialState && state.allItems.length === 0) {
			// Send empty filter to trigger state update
			vscode.postMessage({
				type: "filterMarketplaceItems",
				filters: {
					type: "",
					search: "",
					tags: [],
				},
			})
		}

		// Listen for state changes to know when initial data arrives
		const unsubscribe = manager.onStateChange((newState) => {
			if (newState.allItems.length > 0 && !hasReceivedInitialState) {
				setHasReceivedInitialState(true)
			}
		})

		const handleVisibilityMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "webviewVisible" && message.visible === true) {
				// Data will be automatically fresh when panel becomes visible
				// No manual fetching needed since we removed caching
			}
		}

		window.addEventListener("message", handleVisibilityMessage)
		return () => {
			window.removeEventListener("message", handleVisibilityMessage)
			unsubscribe()
		}
	}, [manager, hasReceivedInitialState, state.allItems.length])

	// Memoize all available tags
	const allTags = useMemo(
		() => Array.from(new Set(state.allItems.flatMap((item) => item.tags || []))).sort(),
		[state.allItems],
	)

	// Memoize filtered tags
	const filteredTags = useMemo(() => allTags, [allTags])

	return (
		<TooltipProvider>
			<Tab>
				<TabHeader className="flex flex-col sticky top-0 z-10 px-3 py-2">
					<div className="flex justify-between items-center px-2">
						<h3 className="font-bold m-0">{t("marketplace:title")}</h3>
						<div className="flex gap-2 items-center">
							<Button
								variant="default"
								onClick={() => {
									onDone?.()
								}}>
								{t("marketplace:done")}
							</Button>
						</div>
					</div>

					<div className="w-full mt-2">
						<div className="flex relative py-1">
							<div className="absolute w-full h-[2px] -bottom-[2px] bg-vscode-input-border">
								<div
									className={cn(
										"absolute w-1/2 h-[2px] bottom-0 bg-vscode-button-background transition-all duration-300 ease-in-out",
										{
											"left-0": state.activeTab === "mcp",
											"left-1/2": state.activeTab === "mode",
										},
									)}
								/>
							</div>
							<button
								className="flex items-center justify-center gap-2 flex-1 text-sm font-medium rounded-sm transition-colors duration-300 relative z-10 text-vscode-foreground"
								onClick={() => manager.transition({ type: "SET_ACTIVE_TAB", payload: { tab: "mcp" } })}>
								MCP
							</button>
							<button
								className="flex items-center justify-center gap-2 flex-1 text-sm font-medium rounded-sm transition-colors duration-300 relative z-10 text-vscode-foreground"
								onClick={() =>
									manager.transition({ type: "SET_ACTIVE_TAB", payload: { tab: "mode" } })
								}>
								Modes
							</button>
						</div>
					</div>
				</TabHeader>

				<TabContent className="p-3 pt-2">
					{state.activeTab === "mcp" && (
						<MarketplaceListView
							stateManager={stateManager}
							allTags={allTags}
							filteredTags={filteredTags}
							filterByType="mcp"
						/>
					)}
					{state.activeTab === "mode" && (
						<MarketplaceListView
							stateManager={stateManager}
							allTags={allTags}
							filteredTags={filteredTags}
							filterByType="mode"
						/>
					)}
				</TabContent>
			</Tab>
		</TooltipProvider>
	)
}
