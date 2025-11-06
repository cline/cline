/**
 * Context configuration types for controlling what gets included in environment details
 */

/**
 * Configuration for workspace directory file listing
 */
export interface WorkdirConfig {
	/** Maximum number of files to include in the file tree */
	maxFileCount: number
	/** Glob patterns for files to include (e.g., ["src/**", "*.ts"]) */
	includePatterns: string[]
	/** Glob patterns for files to exclude (e.g., ["node_modules/**", "dist/**"]) */
	excludePatterns: string[]
}

/**
 * Main context configuration interface
 */
export interface ContextConfig {
	/** Whether to include visible files section in environment details */
	includeVisibleFiles: boolean
	/** Whether to include open tabs section in environment details */
	includeOpenTabs: boolean
	/** Whether to include file tree section in environment details */
	includeFileTree: boolean
	/** Style of file tree display: 'tree' (hierarchical), 'flat' (list), or 'none' (disabled) */
	fileTreeStyle: "tree" | "flat" | "none"
	/** Configuration for workspace directory file listing */
	workdir: WorkdirConfig
}

/**
 * Default context configuration
 * Used when no .clinecontext file is found or when parsing fails
 */
export const DEFAULT_CONFIG: ContextConfig = {
	includeVisibleFiles: true,
	includeOpenTabs: true,
	includeFileTree: true,
	fileTreeStyle: "tree",
	workdir: {
		maxFileCount: 200,
		includePatterns: ["**/*"],
		excludePatterns: [],
	},
}
