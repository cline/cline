/**
 * CLI configuration options
 */
export interface CliConfig {
	/** Enable verbose debug output */
	verbose: boolean
	/** Directory for Cline data storage (default: ~/.cline) */
	configDir: string
}

/**
 * Partial CLI config used when creating config with overrides
 */
export type PartialCliConfig = Partial<CliConfig>
