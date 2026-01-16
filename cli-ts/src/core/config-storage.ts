/**
 * Persistent configuration storage system
 * Stores user configuration in ~/.cline/config.json
 */

import fs from "fs"
import path from "path"
import { getDefaultConfigDir } from "./config.js"

/**
 * Stored configuration schema - what gets persisted to disk
 */
export interface StoredConfig {
	/** Default output format preference */
	outputFormat?: "rich" | "json" | "plain"
	/** Default model to use */
	defaultModel?: string
	/** Default provider */
	defaultProvider?: string
	/** Auto-approval settings */
	autoApprove?: boolean
	/** Custom settings */
	[key: string]: unknown
}

/**
 * Valid configuration keys that can be set
 */
export const VALID_CONFIG_KEYS = ["outputFormat", "defaultModel", "defaultProvider", "autoApprove"] as const

export type ValidConfigKey = (typeof VALID_CONFIG_KEYS)[number]

/**
 * Check if a key is a valid config key
 */
export function isValidConfigKey(key: string): key is ValidConfigKey {
	return VALID_CONFIG_KEYS.includes(key as ValidConfigKey)
}

/**
 * Configuration storage class
 */
export class ConfigStorage {
	private configPath: string
	private configDir: string

	constructor(configDir?: string) {
		this.configDir = configDir || getDefaultConfigDir()
		// TODO this path isn't right, should be ~/.cline/data/blah (look this up in cline core)
		this.configPath = path.join(this.configDir, "config.json")
	}

	/**
	 * Ensure the config directory exists
	 */
	private ensureConfigDir(): void {
		if (!fs.existsSync(this.configDir)) {
			fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 })
		}
	}

	/**
	 * Load the current configuration from disk
	 */
	load(): StoredConfig {
		try {
			if (fs.existsSync(this.configPath)) {
				const content = fs.readFileSync(this.configPath, "utf-8")
				return JSON.parse(content) as StoredConfig
			}
		} catch {
			// Return empty config on error
		}
		return {}
	}

	/**
	 * Save configuration to disk
	 */
	save(config: StoredConfig): void {
		this.ensureConfigDir()
		fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), {
			mode: 0o600,
		})
	}

	/**
	 * Get a specific configuration value
	 */
	get(key: string): unknown {
		const config = this.load()
		return config[key]
	}

	/**
	 * Set a specific configuration value
	 */
	set(key: string, value: unknown): void {
		const config = this.load()
		config[key] = value
		this.save(config)
	}

	/**
	 * Delete a specific configuration key
	 */
	delete(key: string): boolean {
		const config = this.load()
		if (key in config) {
			delete config[key]
			this.save(config)
			return true
		}
		return false
	}

	/**
	 * List all configuration key-value pairs
	 */
	list(): Record<string, unknown> {
		return this.load()
	}

	/**
	 * Clear all configuration
	 */
	clear(): void {
		this.save({})
	}

	/**
	 * Get the path to the config file
	 */
	getConfigPath(): string {
		return this.configPath
	}
}

/**
 * Create a config storage instance
 */
export function createConfigStorage(configDir?: string): ConfigStorage {
	return new ConfigStorage(configDir)
}

/**
 * Validate and parse a config value from string input
 */
export function parseConfigValue(key: string, value: string): unknown {
	// Handle boolean values
	if (key === "autoApprove") {
		if (value === "true" || value === "1" || value === "yes") {
			return true
		}
		if (value === "false" || value === "0" || value === "no") {
			return false
		}
		throw new Error(`Invalid boolean value for ${key}: ${value}. Use true/false, 1/0, or yes/no.`)
	}

	// Handle output format
	if (key === "outputFormat") {
		if (value === "rich" || value === "json" || value === "plain") {
			return value
		}
		throw new Error(`Invalid output format: ${value}. Valid options are: rich, json, plain`)
	}

	// Default: return as string
	return value
}
