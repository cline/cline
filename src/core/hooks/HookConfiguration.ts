/**
 * Hook Configuration Loader
 * Manages loading and caching of hook configurations
 */

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { DEFAULT_HOOK_CONFIG, HookConfiguration, validateHookConfiguration } from "./types/HookConfiguration"

export class HookConfigurationLoader {
	private configCache: HookConfiguration | null = null
	private configPath: string
	private lastModified: number = 0

	constructor(configPath?: string) {
		// Default to ~/.cline/hooks.json
		this.configPath = configPath || path.join(os.homedir(), ".cline", "hooks.json")
	}

	/**
	 * Get the current hook configuration
	 * Reloads if file has been modified
	 */
	async getConfiguration(): Promise<HookConfiguration> {
		try {
			const stats = await fs.stat(this.configPath)
			const mtime = stats.mtimeMs

			// Return cached config if file hasn't changed
			if (this.configCache && mtime === this.lastModified) {
				return this.configCache
			}

			// Load and validate configuration
			const configData = await fs.readFile(this.configPath, "utf-8")
			const config = JSON.parse(configData)

			if (!validateHookConfiguration(config)) {
				console.error("Invalid hook configuration format")
				return DEFAULT_HOOK_CONFIG
			}

			// Update cache
			this.configCache = config
			this.lastModified = mtime

			return config
		} catch (error) {
			// Return default config if file doesn't exist or is invalid
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				// File doesn't exist - this is normal for users without hooks
				return DEFAULT_HOOK_CONFIG
			}

			console.error("Failed to load hook configuration:", error)
			return DEFAULT_HOOK_CONFIG
		}
	}

	/**
	 * Save hook configuration
	 */
	async saveConfiguration(config: HookConfiguration): Promise<void> {
		// Ensure directory exists
		const dir = path.dirname(this.configPath)
		await fs.mkdir(dir, { recursive: true })

		// Write configuration
		const configData = JSON.stringify(config, null, 2)
		await fs.writeFile(this.configPath, configData, "utf-8")

		// Update cache
		this.configCache = config
		const stats = await fs.stat(this.configPath)
		this.lastModified = stats.mtimeMs
	}

	/**
	 * Check if hooks are configured
	 */
	async hasHooks(): Promise<boolean> {
		const config = await this.getConfiguration()
		return Object.keys(config.hooks).length > 0
	}

	/**
	 * Get the configuration file path
	 */
	getConfigPath(): string {
		return this.configPath
	}

	/**
	 * Clear the configuration cache
	 */
	clearCache(): void {
		this.configCache = null
		this.lastModified = 0
	}
}
