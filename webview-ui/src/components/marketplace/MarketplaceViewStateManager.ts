/**
 * MarketplaceViewStateManager
 *
 * This class manages the state for the marketplace view in the Roo Code extensions interface.
 *
 * IMPORTANT: Fixed issue where the marketplace feature was causing the Roo Code extensions interface
 * to switch to the browse tab and redraw it every 30 seconds. The fix prevents unnecessary tab switching
 * and redraws by:
 * 1. Only updating the UI when necessary
 * 2. Preserving the current tab when handling timeouts
 * 3. Using minimal state updates to avoid resetting scroll position
 */

import { MarketplaceItem } from "@roo-code/types"
import { vscode } from "../../utils/vscode"
import { WebviewMessage } from "../../../../src/shared/WebviewMessage"
import type { MarketplaceInstalledMetadata } from "../../../../src/shared/ExtensionMessage"

export interface ViewState {
	allItems: MarketplaceItem[]
	organizationMcps: MarketplaceItem[]
	displayItems?: MarketplaceItem[] // Items currently being displayed (filtered or all)
	displayOrganizationMcps?: MarketplaceItem[] // Organization MCPs currently being displayed (filtered or all)
	isFetching: boolean
	activeTab: "mcp" | "mode"
	filters: {
		type: string
		search: string
		tags: string[]
		installed: "all" | "installed" | "not_installed" // Filter by installation status
	}
	installedMetadata?: MarketplaceInstalledMetadata // Store installed metadata for filtering
}

type TransitionPayloads = {
	FETCH_ITEMS: undefined
	FETCH_COMPLETE: { items: MarketplaceItem[] }
	FETCH_ERROR: undefined
	SET_ACTIVE_TAB: { tab: ViewState["activeTab"] }
	UPDATE_FILTERS: { filters: Partial<ViewState["filters"]> }
}

export interface ViewStateTransition {
	type: keyof TransitionPayloads
	payload?: TransitionPayloads[keyof TransitionPayloads]
}

export type StateChangeHandler = (state: ViewState) => void

export class MarketplaceViewStateManager {
	private state: ViewState = this.loadInitialState()

	private loadInitialState(): ViewState {
		// Always start with default state - no sessionStorage caching
		// This ensures fresh data from the extension is always used
		return this.getDefaultState()
	}

	private getDefaultState(): ViewState {
		return {
			allItems: [],
			organizationMcps: [],
			displayItems: [], // Always initialize as empty array, not undefined
			displayOrganizationMcps: [], // Always initialize as empty array, not undefined
			isFetching: true, // Start with loading state for initial load
			activeTab: "mcp",
			filters: {
				type: "",
				search: "",
				tags: [],
				installed: "all",
			},
		}
	}
	// Removed auto-polling timeout
	private stateChangeHandlers: Set<StateChangeHandler> = new Set()

	// Empty constructor is required for test initialization
	constructor() {
		// Initialize is now handled by the loadInitialState call in the property initialization
	}

	public initialize(): void {
		// Set initial state
		this.state = this.getDefaultState()
	}

	public onStateChange(handler: StateChangeHandler): () => void {
		this.stateChangeHandlers.add(handler)
		return () => this.stateChangeHandlers.delete(handler)
	}

	public cleanup(): void {
		// Reset fetching state
		if (this.state.isFetching) {
			this.state.isFetching = false
			this.notifyStateChange()
		}

		// Clear handlers but preserve state
		this.stateChangeHandlers.clear()
	}

	public getState(): ViewState {
		// Only create new arrays if they exist and have items
		const allItems = this.state.allItems.length ? [...this.state.allItems] : []
		const organizationMcps = this.state.organizationMcps.length ? [...this.state.organizationMcps] : []
		// Ensure displayItems is always an array, never undefined
		// If displayItems is undefined or null, fall back to allItems
		const displayItems = this.state.displayItems ? [...this.state.displayItems] : [...allItems]
		const displayOrganizationMcps = this.state.displayOrganizationMcps
			? [...this.state.displayOrganizationMcps]
			: [...organizationMcps]
		const tags = this.state.filters.tags.length ? [...this.state.filters.tags] : []

		// Create minimal new state object
		return {
			...this.state,
			allItems,
			organizationMcps,
			displayItems,
			displayOrganizationMcps,
			filters: {
				...this.state.filters,
				tags,
			},
		}
	}

	/**
	 * Notify all registered handlers of a state change
	 * @param preserveTab If true, ensures the active tab is not changed during notification
	 */
	private notifyStateChange(preserveTab: boolean = false): void {
		const newState = this.getState() // Use getState to ensure proper copying

		if (preserveTab) {
			// When preserveTab is true, we're careful not to cause tab switching
			// This is used during timeout handling to prevent disrupting the user
			this.stateChangeHandlers.forEach((handler) => {
				// Store the current active tab
				const currentTab = newState.activeTab

				// Create a state update that won't change the active tab
				const safeState = {
					...newState,
					// Don't change these properties to avoid UI disruption
					activeTab: currentTab,
				}
				handler(safeState)
			})
		} else {
			// Normal state change notification
			this.stateChangeHandlers.forEach((handler) => {
				handler(newState)
			})
		}

		// Removed sessionStorage caching to ensure fresh data from extension is always used
		// This prevents old cached marketplace items from overriding fresh data
	}

	public async transition(transition: ViewStateTransition): Promise<void> {
		switch (transition.type) {
			case "FETCH_ITEMS": {
				// Set fetching state to show loading indicator
				this.state = {
					...this.state,
					isFetching: true,
				}
				this.notifyStateChange()
				break
			}

			case "FETCH_COMPLETE": {
				const { items } = transition.payload as TransitionPayloads["FETCH_COMPLETE"]
				// No timeout to clear anymore

				// Compare with current state to avoid unnecessary updates
				if (JSON.stringify(items) === JSON.stringify(this.state.allItems)) {
					// No changes: update only isFetching flag and send minimal update
					this.state.isFetching = false
					this.stateChangeHandlers.forEach((handler) => {
						handler({
							...this.getState(),
							isFetching: false,
						})
					})
					break
				}

				// Calculate display items based on current filters
				let newDisplayItems: MarketplaceItem[]
				let newDisplayOrganizationMcps: MarketplaceItem[]
				if (this.isFilterActive()) {
					newDisplayItems = this.filterItems([...items], this.state.installedMetadata)
					newDisplayOrganizationMcps = this.filterItems(
						[...this.state.organizationMcps],
						this.state.installedMetadata,
					)
				} else {
					// No filters active - show all items
					newDisplayItems = [...items]
					newDisplayOrganizationMcps = [...this.state.organizationMcps]
				}

				// Update allItems as source of truth
				this.state = {
					...this.state,
					allItems: [...items],
					displayItems: newDisplayItems,
					displayOrganizationMcps: newDisplayOrganizationMcps,
					isFetching: false,
				}

				// Notify state change
				this.notifyStateChange()
				break
			}

			case "FETCH_ERROR": {
				// Preserve current filters and items
				const { filters, activeTab, allItems, displayItems } = this.state

				// Reset state but preserve filters and items
				this.state = {
					...this.getDefaultState(),
					filters,
					activeTab,
					allItems,
					displayItems,
					isFetching: false,
				}
				this.notifyStateChange()
				break
			}

			case "SET_ACTIVE_TAB": {
				const { tab } = transition.payload as TransitionPayloads["SET_ACTIVE_TAB"]

				// Update tab state
				this.state = {
					...this.state,
					activeTab: tab,
				}

				// Tab switching no longer triggers fetch - data comes automatically from extension

				this.notifyStateChange()
				break
			}

			case "UPDATE_FILTERS": {
				const { filters = {} } = (transition.payload as TransitionPayloads["UPDATE_FILTERS"]) || {}

				// Create new filters object preserving existing values for undefined fields
				const updatedFilters = {
					type: filters.type !== undefined ? filters.type : this.state.filters.type,
					search: filters.search !== undefined ? filters.search : this.state.filters.search,
					tags: filters.tags !== undefined ? filters.tags : this.state.filters.tags,
					installed: filters.installed !== undefined ? filters.installed : this.state.filters.installed,
				}

				// Update filters first
				this.state = {
					...this.state,
					filters: updatedFilters,
				}

				// Apply filters to displayItems and displayOrganizationMcps with the updated filters
				const newDisplayItems = this.filterItems(this.state.allItems, this.state.installedMetadata)
				const newDisplayOrganizationMcps = this.filterItems(
					this.state.organizationMcps,
					this.state.installedMetadata,
				)

				// Update state with filtered items
				this.state = {
					...this.state,
					displayItems: newDisplayItems,
					displayOrganizationMcps: newDisplayOrganizationMcps,
				}

				// Send filter message
				vscode.postMessage({
					type: "filterMarketplaceItems",
					filters: updatedFilters,
				} as WebviewMessage)

				this.notifyStateChange()

				break
			}
		}
	}

	public isFilterActive(): boolean {
		return !!(
			this.state.filters.type ||
			this.state.filters.search ||
			this.state.filters.tags.length > 0 ||
			this.state.filters.installed !== "all"
		)
	}

	public filterItems(items: MarketplaceItem[], installedMetadata?: MarketplaceInstalledMetadata): MarketplaceItem[] {
		const { type, search, tags, installed } = this.state.filters
		const searchLower = search?.toLowerCase()

		return items.filter((item) => {
			// Check type match
			if (type && item.type !== type) {
				return false
			}

			// Check search match
			if (searchLower) {
				const nameMatch = item.name.toLowerCase().includes(searchLower)
				const descriptionMatch = (item.description || "").toLowerCase().includes(searchLower)
				if (!nameMatch && !descriptionMatch) {
					return false
				}
			}

			// Check tag match
			if (tags.length > 0 && !item.tags?.some((tag) => tags.includes(tag))) {
				return false
			}

			// Check installed status if filter is active
			if (installed !== "all" && installedMetadata) {
				const isInstalledGlobally = !!installedMetadata?.global?.[item.id]
				const isInstalledInProject = !!installedMetadata?.project?.[item.id]
				const isInstalled = isInstalledGlobally || isInstalledInProject

				if (installed === "installed" && !isInstalled) {
					return false
				}
				if (installed === "not_installed" && isInstalled) {
					return false
				}
			}

			return true
		})
	}

	public async handleMessage(message: any): Promise<void> {
		// Handle empty or invalid message
		if (!message || !message.type || message.type === "invalidType") {
			this.state = {
				...this.getDefaultState(),
			}
			this.notifyStateChange()
			return
		}

		// Handle state updates
		if (message.type === "state") {
			// Handle empty state
			if (!message.state) {
				this.state = {
					...this.getDefaultState(),
				}
				this.notifyStateChange()
				return
			}

			// Handle state updates for marketplace items
			// The state.marketplaceItems come from ClineProvider, see the file src/core/webview/ClineProvider.ts
			const marketplaceItems = message.state.marketplaceItems
			const marketplaceInstalledMetadata = message.state.marketplaceInstalledMetadata

			if (marketplaceItems !== undefined) {
				// Always use the marketplace items from the extension when they're provided
				// This ensures fresh data is always displayed
				const items = [...marketplaceItems]

				// Update installed metadata if provided
				if (marketplaceInstalledMetadata !== undefined) {
					this.state.installedMetadata = marketplaceInstalledMetadata
				}

				// Calculate display items based on current filters
				// If no filters are active, show all items
				// If filters are active, apply filtering
				let newDisplayItems: MarketplaceItem[]
				let newDisplayOrganizationMcps: MarketplaceItem[]
				if (this.isFilterActive()) {
					newDisplayItems = this.filterItems(items, this.state.installedMetadata)
					newDisplayOrganizationMcps = this.filterItems(
						this.state.organizationMcps,
						this.state.installedMetadata,
					)
				} else {
					// No filters active - show all items
					newDisplayItems = items
					newDisplayOrganizationMcps = this.state.organizationMcps
				}

				// Update state in a single operation
				this.state = {
					...this.state,
					isFetching: false,
					allItems: items,
					displayItems: newDisplayItems,
					displayOrganizationMcps: newDisplayOrganizationMcps,
					installedMetadata: marketplaceInstalledMetadata || this.state.installedMetadata,
				}
				// Notification is handled below after all state parts are processed
			}

			// Notify state change once after processing all parts (sources, metadata, items)
			// This prevents multiple redraws for a single 'state' message
			// Determine if notification should preserve tab based on item update logic
			const isOnMcpTab = this.state.activeTab === "mcp"
			const hasCurrentItems = (this.state.allItems || []).length > 0
			const preserveTab = !isOnMcpTab && hasCurrentItems

			this.notifyStateChange(preserveTab)
		}

		// Handle marketplace button clicks
		if (message.type === "marketplaceButtonClicked") {
			if (message.text) {
				// Error case
				void this.transition({ type: "FETCH_ERROR" })
			} else {
				// Check if a specific tab is requested
				if (
					message.values?.marketplaceTab &&
					(message.values.marketplaceTab === "mcp" || message.values.marketplaceTab === "mode")
				) {
					// Set the active tab
					void this.transition({
						type: "SET_ACTIVE_TAB",
						payload: { tab: message.values.marketplaceTab },
					})
				}

				// Refresh request
				void this.transition({ type: "FETCH_ITEMS" })
			}
		}

		// Handle marketplace data updates (fetched on demand)
		if (message.type === "marketplaceData") {
			const marketplaceItems = message.marketplaceItems
			const organizationMcps = message.organizationMcps || []
			const marketplaceInstalledMetadata = message.marketplaceInstalledMetadata

			if (marketplaceItems !== undefined) {
				// Always use the marketplace items from the extension when they're provided
				// This ensures fresh data is always displayed
				const items = [...marketplaceItems]
				const orgMcps = [...organizationMcps]

				// Update installed metadata if provided
				if (marketplaceInstalledMetadata !== undefined) {
					this.state.installedMetadata = marketplaceInstalledMetadata
				}

				const newDisplayItems = this.isFilterActive()
					? this.filterItems(items, this.state.installedMetadata)
					: items
				const newDisplayOrganizationMcps = this.isFilterActive()
					? this.filterItems(orgMcps, this.state.installedMetadata)
					: orgMcps

				// Update state in a single operation
				this.state = {
					...this.state,
					isFetching: false,
					allItems: items,
					organizationMcps: orgMcps,
					displayItems: newDisplayItems,
					displayOrganizationMcps: newDisplayOrganizationMcps,
					installedMetadata: marketplaceInstalledMetadata || this.state.installedMetadata,
				}
			}

			// Notify state change
			this.notifyStateChange()
		}
	}
}
