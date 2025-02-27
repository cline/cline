import fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { fileExistsAtPath } from "../../utils/fs"
import { getDefaultExclusions } from "./CheckpointExclusions"
import { CheckpointSettings } from "../../shared/Checkpoints"

/**
 * CheckpointSettings Module
 *
 * Manages user-configurable settings for the Checkpoints system. Key features:
 *
 * Settings Management:
 * - Enable/disable checkpoints functionality
 *
 * File Exclusions Management:
 * - .checkpointsignore file for exclusion patterns
 * - Default patterns for common file types
 * - User-customizable pattern list
 *
 * Storage Structure:
 * - Settings stored in globalStorage/settings/cline_checkpoints_settings.json
 * - Ignore patterns stored in globalStorage/settings/.checkpointsignore
 *
 * Integration Points:
 * - Used by CheckpointTracker for file filtering
 * - Consumed by CheckpointExclusions for pattern management
 */

/**
 * Default settings values.
 * These are used when no settings file exists or when reading fails.
 */
const DEFAULT_SETTINGS: CheckpointSettings = {
	enableCheckpoints: true, // Enabled by default
}

/**
 * CheckpointSettingsManager Class
 *
 * Handles all checkpoint settings operations including:
 * - Reading and writing settings to disk
 * - Managing .checkpointsignore patterns
 * - Providing default values when needed
 *
 * File Structure:
 * globalStorage/
 *   settings/
 *     cline_checkpoints_settings.json - Contains enable flag
 *     .checkpointsignore - Contains file exclusion patterns
 */
export class CheckpointSettingsManager {
	public readonly settingsDir: string
	public readonly checkpointSettingsPath: string
	public readonly checkpointsIgnorePath: string
	private settings: CheckpointSettings = DEFAULT_SETTINGS
	private static instance: CheckpointSettingsManager | null = null

	/**
	 * Creates a new CheckpointSettingsManager instance.
	 * Initializes paths for settings and ignore files.
	 *
	 * @param globalStoragePath - VS Code's global storage path for the extension
	 */
	private constructor(globalStoragePath: string) {
		this.settingsDir = path.join(globalStoragePath, "settings")
		this.checkpointSettingsPath = path.join(this.settingsDir, "cline_checkpoints_settings.json")
		this.checkpointsIgnorePath = path.join(this.settingsDir, ".checkpointsignore")
		this.readSettings().then((settings) => {
			this.settings = settings
			this.migrateEnableCheckpointsSetting()
		})
		this.ensureIgnoreFileExists()
	}

	/**
	 * Initialize the singleton instance
	 */
	public static initialize(globalStoragePath: string): void {
		if (!CheckpointSettingsManager.instance) {
			CheckpointSettingsManager.instance = new CheckpointSettingsManager(globalStoragePath)
		}
	}

	/**
	 * Get the singleton instance
	 */
	public static getInstance(): CheckpointSettingsManager {
		if (!CheckpointSettingsManager.instance) {
			throw new Error("CheckpointSettingsManager not initialized")
		}
		return CheckpointSettingsManager.instance
	}

	/**
	 * Retrieves current checkpoint settings from memory.
	 *
	 * @returns CheckpointSettings Current settings
	 */
	getSettings(): CheckpointSettings {
		return this.settings
	}

	/**
	 * Reads checkpoint settings from disk.
	 * Merges stored settings with defaults to ensure all fields are present.
	 *
	 * @returns Promise<CheckpointSettings> Settings read from disk, with defaults for any missing values
	 */
	private async readSettings(): Promise<CheckpointSettings> {
		try {
			if (await fileExistsAtPath(this.checkpointSettingsPath)) {
				const settingsContent = await fs.readFile(this.checkpointSettingsPath, "utf8")
				return { ...DEFAULT_SETTINGS, ...JSON.parse(settingsContent) }
			}
			// If file doesn't exist, create it with default settings
			await this.saveSettings(DEFAULT_SETTINGS)
		} catch (error) {
			console.error("Error reading checkpoint settings:", error)
		}
		return DEFAULT_SETTINGS
	}

	/**
	 * Saves checkpoint settings to disk and updates in-memory settings.
	 * Creates settings directory if it doesn't exist.
	 * Merges new settings with existing ones.
	 *
	 * @param settings - Partial settings to update
	 */
	async saveSettings(settings: Partial<CheckpointSettings>): Promise<void> {
		// Ensure settings directory exists
		await fs.mkdir(this.settingsDir, { recursive: true })

		// Merge with current settings
		const updatedSettings = { ...this.settings, ...settings }
		this.settings = updatedSettings

		// Save to disk
		await fs.writeFile(this.checkpointSettingsPath, JSON.stringify(updatedSettings, null, 2))
	}

	/**
	 * Retrieves patterns from .checkpointsignore file.
	 * Filters out empty lines and comments.
	 *
	 * @returns Promise<string[]> Array of active ignore patterns
	 */
	async getIgnorePatterns(): Promise<string[]> {
		try {
			if (await fileExistsAtPath(this.checkpointsIgnorePath)) {
				const content = await fs.readFile(this.checkpointsIgnorePath, "utf8")
				return content.split("\n").filter((line) => line.trim() && !line.startsWith("#"))
			}
		} catch (error) {
			console.error("Error loading .checkpointsignore:", error)
		}
		return []
	}

	/**
	 * Ensures .checkpointsignore file exists.
	 * Creates it with default patterns if it doesn't exist.
	 */
	private async ensureIgnoreFileExists(): Promise<void> {
		try {
			await fs.mkdir(this.settingsDir, { recursive: true })

			if (!(await fileExistsAtPath(this.checkpointsIgnorePath))) {
				await fs.writeFile(this.checkpointsIgnorePath, getDefaultExclusions().join("\n"))
			}
		} catch (error) {
			console.error("Error creating .checkpointsignore:", error)
		}
	}

	/**
	 * Migrates the enableCheckpoints setting from VSCode configuration to settings file
	 * All checkpoints settings will be kept in the CheckpointSettingsView from now on
	 */
	private async migrateEnableCheckpointsSetting(): Promise<void> {
		const config = vscode.workspace.getConfiguration("cline")
		const enableCheckpoints = config.get<boolean>("enableCheckpoints")

		if (enableCheckpoints !== undefined) {
			// Save to settings file
			await this.saveSettings({
				enableCheckpoints,
			})

			// Remove from VSCode configuration
			await config.update("enableCheckpoints", undefined, true)
		}
	}

	/**
	 * Reinitializes the settings manager by reading settings from disk.
	 * This should be called when a new CheckpointTracker is created.
	 */
	async reinitialize(): Promise<void> {
		this.settings = await this.readSettings()
	}
}
