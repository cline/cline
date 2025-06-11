/**
 * Supported component types
 */
export type MarketplaceItemType = "mode" | "mcp"

/**
 * Local marketplace config types
 */
export interface MarketplaceConfig<T = any> {
	items: Record<string, T>
}

export interface MarketplaceYamlConfig<T = any> {
	items: T[]
}

export interface ModeMarketplaceItem {
	id: string
	name: string
	description: string
	author?: string
	authorUrl?: string
	tags?: string[]
	content: string // Embedded YAML content for .roomodes
	prerequisites?: string[]
}

export interface McpParameter {
	name: string
	key: string
	placeholder?: string
	optional?: boolean // Defaults to false if not provided
}

export interface McpInstallationMethod {
	name: string
	content: string
	parameters?: McpParameter[]
	prerequisites?: string[]
}

export interface McpMarketplaceItem {
	id: string
	name: string
	description: string
	author?: string
	authorUrl?: string
	url: string // Required url field
	tags?: string[]
	content: string | McpInstallationMethod[] // Can be a single config or array of named methods
	parameters?: McpParameter[]
	prerequisites?: string[]
}

/**
 * Unified marketplace item for UI
 */
export interface MarketplaceItem {
	id: string
	name: string
	description: string
	type: MarketplaceItemType
	author?: string
	authorUrl?: string
	url?: string // Optional - only MCPs have url
	tags?: string[]
	content: string | McpInstallationMethod[] // Can be a single config or array of named methods
	parameters?: McpParameter[] // Optional parameters for MCPs
	prerequisites?: string[]
}

export interface InstallMarketplaceItemOptions {
	/**
	 * Specify the target scope
	 *
	 * @default 'project'
	 */
	target?: "global" | "project"
	/**
	 * Parameters provided by the user for configurable marketplace items
	 */
	parameters?: Record<string, any>
}

export interface RemoveInstalledMarketplaceItemOptions {
	/**
	 * Specify the target scope
	 *
	 * @default 'project'
	 */
	target?: "global" | "project"
}
