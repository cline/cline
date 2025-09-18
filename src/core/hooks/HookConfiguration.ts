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
	private globalConfigPath: string
	private projectConfigPath?: string
	private globalLastModified: number = 0
	private projectLastModified: number = 0

	constructor(projectRoot?: string) {
		// Global config path: ~/.cline/settings.json
		this.globalConfigPath = path.join(os.homedir(), ".cline", "settings.json")

		// Project config path: <projectRoot>/.cline/settings.json
		if (projectRoot) {
			this.projectConfigPath = path.join(projectRoot, ".cline", "settings.json")
		}
	}

	/**
	 * Get the current hook configuration
	 * Loads and merges global and project-level configurations
	 */
	async getConfiguration(): Promise<HookConfiguration> {
		try {
			// Check if we need to reload configurations
			const needsReload = await this.checkIfNeedsReload()

			if (!needsReload && this.configCache) {
				return this.configCache
			}

			// Load global configuration
			const globalConfig = await this.loadConfigFile(this.globalConfigPath, "global")

			// Load project configuration if available
			let projectConfig: HookConfiguration | null = null
			if (this.projectConfigPath) {
				projectConfig = await this.loadConfigFile(this.projectConfigPath, "project")
			}

			// Merge configurations (project overrides global)
			const mergedConfig = this.mergeConfigurations(globalConfig, projectConfig)

			// Update cache
			this.configCache = mergedConfig

			// Update modification times
			await this.updateModificationTimes()

			return mergedConfig
		} catch (error) {
			console.error("Failed to load hook configuration:", error)
			return DEFAULT_HOOK_CONFIG
		}
	}

	/**
	 * Load a configuration file
	 */
	private async loadConfigFile(filePath: string, type: "global" | "project"): Promise<HookConfiguration | null> {
		try {
			const configData = await fs.readFile(filePath, "utf-8")
			const config = JSON.parse(configData)

			if (!validateHookConfiguration(config)) {
				console.error(`Invalid ${type} hook configuration format in ${filePath}`)
				return null
			}

			return config
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				// File doesn't exist - this is normal
				return null
			}

			console.error(`Failed to load ${type} hook configuration from ${filePath}:`, error)
			return null
		}
	}

	/**
	 * Check if configurations need to be reloaded
	 */
	private async checkIfNeedsReload(): Promise<boolean> {
		try {
			// Check global config modification time
			const globalStats = await fs.stat(this.globalConfigPath).catch(() => null)
			const globalMtime = globalStats?.mtimeMs || 0

			if (globalMtime !== this.globalLastModified) {
				return true
			}

			// Check project config modification time if applicable
			if (this.projectConfigPath) {
				const projectStats = await fs.stat(this.projectConfigPath).catch(() => null)
				const projectMtime = projectStats?.mtimeMs || 0

				if (projectMtime !== this.projectLastModified) {
					return true
				}
			}

			return false
		} catch {
			return true
		}
	}

	/**
	 * Update cached modification times
	 */
	private async updateModificationTimes(): Promise<void> {
		try {
			const globalStats = await fs.stat(this.globalConfigPath).catch(() => null)
			this.globalLastModified = globalStats?.mtimeMs || 0

			if (this.projectConfigPath) {
				const projectStats = await fs.stat(this.projectConfigPath).catch(() => null)
				this.projectLastModified = projectStats?.mtimeMs || 0
			}
		} catch {
			// Ignore errors
		}
	}

	/**
	 * Merge global and project configurations
	 * Project configuration takes precedence
	 */
	private mergeConfigurations(
		globalConfig: HookConfiguration | null,
		projectConfig: HookConfiguration | null,
	): HookConfiguration {
		// If neither exists, return default
		if (!globalConfig && !projectConfig) {
			return DEFAULT_HOOK_CONFIG
		}

		// If only one exists, use it
		if (!globalConfig) {
			return projectConfig!
		}
		if (!projectConfig) {
			return globalConfig
		}

		// Merge configurations - project overrides global
		const merged: HookConfiguration = {
			hooks: { ...DEFAULT_HOOK_CONFIG.hooks },
			settings: { ...globalConfig.settings, ...projectConfig.settings },
		}

		// Merge hook arrays for each event type
		const hookEventTypes = [
			"PreToolUse",
			"PostToolUse",
			"UserPromptSubmit",
			"Stop",
			"SessionStart",
			"SessionEnd",
			"SubagentStop",
			"PreCompact",
			"Notification",
		] as const

		for (const eventType of hookEventTypes) {
			const globalHooks = globalConfig.hooks[eventType] || []
			const projectHooks = projectConfig.hooks[eventType] || []

			// Combine hooks - project hooks are executed after global hooks
			merged.hooks[eventType] = [...globalHooks, ...projectHooks]
		}

		return merged
	}

	/**
	 * Save hook configuration (saves to project config by default)
	 */
	async saveConfiguration(config: HookConfiguration, target: "global" | "project" = "project"): Promise<void> {
		const configPath = target === "global" ? this.globalConfigPath : this.projectConfigPath || this.globalConfigPath

		// Ensure directory exists
		const dir = path.dirname(configPath)
		await fs.mkdir(dir, { recursive: true })

		// Write configuration
		const configData = JSON.stringify(config, null, 2)
		await fs.writeFile(configPath, configData, "utf-8")

		// Clear cache to force reload on next access
		this.clearCache()
	}

	/**
	 * Check if hooks are configured
	 */
	async hasHooks(): Promise<boolean> {
		const config = await this.getConfiguration()

		// Check if any hook arrays have content
		for (const eventType of Object.keys(config.hooks)) {
			const hooks = (config.hooks as any)[eventType]
			if (Array.isArray(hooks) && hooks.length > 0) {
				return true
			}
		}

		return false
	}

	/**
	 * Get the configuration file paths
	 */
	getConfigPaths(): { global: string; project?: string } {
		return {
			global: this.globalConfigPath,
			project: this.projectConfigPath,
		}
	}

	/**
	 * Clear the configuration cache
	 */
	clearCache(): void {
		this.configCache = null
		this.globalLastModified = 0
		this.projectLastModified = 0
	}
}
