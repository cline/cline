import os from "os"
import path from "path"
import type { CliConfig, PartialCliConfig } from "../types/config.js"

/**
 * Get the default Cline configuration directory
 * @returns Path to ~/.cline
 */
export function getDefaultConfigDir(): string {
	return path.join(os.homedir(), ".cline")
}

/**
 * Default CLI configuration values
 */
export const DEFAULT_CLI_CONFIG: CliConfig = {
	verbose: false,
	configDir: getDefaultConfigDir(),
}

/**
 * Create a CLI configuration by merging defaults with provided options
 */
export function createConfig(options: PartialCliConfig = {}): CliConfig {
	return {
		...DEFAULT_CLI_CONFIG,
		...options,
	}
}
