import type { OutputFormat } from "../core/output/types.js"

/**
 * CLI configuration options
 */
export interface CliConfig {
	/** Enable verbose debug output */
	verbose: boolean
	/** Directory for Cline data storage (default: ~/.cline) */
	configDir: string
	/** Output format: rich, json, or plain */
	outputFormat: OutputFormat
}

/**
 * Partial CLI config used when creating config with overrides
 */
export type PartialCliConfig = Partial<CliConfig>
