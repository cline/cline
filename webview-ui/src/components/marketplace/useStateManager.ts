import { useState, useEffect } from "react"
import { MarketplaceViewStateManager, ViewState } from "./MarketplaceViewStateManager"

export function useStateManager(existingManager?: MarketplaceViewStateManager) {
	const [manager] = useState(() => existingManager || new MarketplaceViewStateManager())
	const [state, setState] = useState(() => manager.getState())

	useEffect(() => {
		const handleStateChange = (newState: ViewState) => {
			setState((prevState) => {
				// Compare specific state properties that matter for rendering
				const hasChanged =
					prevState.isFetching !== newState.isFetching ||
					prevState.activeTab !== newState.activeTab ||
					JSON.stringify(prevState.allItems) !== JSON.stringify(newState.allItems) ||
					JSON.stringify(prevState.organizationMcps) !== JSON.stringify(newState.organizationMcps) ||
					JSON.stringify(prevState.displayItems) !== JSON.stringify(newState.displayItems) ||
					JSON.stringify(prevState.displayOrganizationMcps) !==
						JSON.stringify(newState.displayOrganizationMcps) ||
					JSON.stringify(prevState.filters) !== JSON.stringify(newState.filters)

				return hasChanged ? newState : prevState
			})
		}

		const handleMessage = (event: MessageEvent) => {
			manager.handleMessage(event.data)
		}

		// Register message handler immediately
		window.addEventListener("message", handleMessage)

		// Register state change handler
		const unsubscribe = manager.onStateChange(handleStateChange)

		// Force initial state sync
		handleStateChange(manager.getState())

		return () => {
			window.removeEventListener("message", handleMessage)
			unsubscribe()
			// Don't cleanup the manager if it was provided externally
			if (!existingManager) {
				manager.cleanup()
			}
		}
	}, [manager, existingManager])

	return [state, manager] as const
}
