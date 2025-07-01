import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"

import * as yaml from "yaml"
import stripBom from "strip-bom"

import { type ModeConfig, type PromptComponent, customModesSettingsSchema, modeConfigSchema } from "@roo-code/types"

import { fileExistsAtPath } from "../../utils/fs"
import { getWorkspacePath } from "../../utils/path"
import { getGlobalRooDirectory } from "../../services/roo-config"
import { logger } from "../../utils/logging"
import { GlobalFileNames } from "../../shared/globalFileNames"
import { ensureSettingsDirectoryExists } from "../../utils/globalContext"
import { t } from "../../i18n"

const ROOMODES_FILENAME = ".roomodes"

// Type definitions for import/export functionality
interface RuleFile {
	relativePath: string
	content: string
}

interface ExportedModeConfig extends ModeConfig {
	rulesFiles?: RuleFile[]
}

interface ImportData {
	customModes: ExportedModeConfig[]
}

interface ExportResult {
	success: boolean
	yaml?: string
	error?: string
}

interface ImportResult {
	success: boolean
	error?: string
}

export class CustomModesManager {
	private static readonly cacheTTL = 10_000

	private disposables: vscode.Disposable[] = []
	private isWriting = false
	private writeQueue: Array<() => Promise<void>> = []
	private cachedModes: ModeConfig[] | null = null
	private cachedAt: number = 0

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly onUpdate: () => Promise<void>,
	) {
		this.watchCustomModesFiles().catch((error) => {
			console.error("[CustomModesManager] Failed to setup file watchers:", error)
		})
	}

	private async queueWrite(operation: () => Promise<void>): Promise<void> {
		this.writeQueue.push(operation)

		if (!this.isWriting) {
			await this.processWriteQueue()
		}
	}

	private async processWriteQueue(): Promise<void> {
		if (this.isWriting || this.writeQueue.length === 0) {
			return
		}

		this.isWriting = true

		try {
			while (this.writeQueue.length > 0) {
				const operation = this.writeQueue.shift()

				if (operation) {
					await operation()
				}
			}
		} finally {
			this.isWriting = false
		}
	}

	private async getWorkspaceRoomodes(): Promise<string | undefined> {
		const workspaceFolders = vscode.workspace.workspaceFolders

		if (!workspaceFolders || workspaceFolders.length === 0) {
			return undefined
		}

		const workspaceRoot = getWorkspacePath()
		const roomodesPath = path.join(workspaceRoot, ROOMODES_FILENAME)
		const exists = await fileExistsAtPath(roomodesPath)
		return exists ? roomodesPath : undefined
	}

	/**
	 * Regex pattern for problematic characters that need to be cleaned from YAML content
	 * Includes:
	 * - \u00A0: Non-breaking space
	 * - \u200B-\u200D: Zero-width spaces and joiners
	 * - \u2010-\u2015, \u2212: Various dash characters
	 * - \u2018-\u2019: Smart single quotes
	 * - \u201C-\u201D: Smart double quotes
	 */
	private static readonly PROBLEMATIC_CHARS_REGEX =
		// eslint-disable-next-line no-misleading-character-class
		/[\u00A0\u200B\u200C\u200D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u2018\u2019\u201C\u201D]/g

	/**
	 * Clean invisible and problematic characters from YAML content
	 */
	private cleanInvisibleCharacters(content: string): string {
		// Single pass replacement for all problematic characters
		return content.replace(CustomModesManager.PROBLEMATIC_CHARS_REGEX, (match) => {
			switch (match) {
				case "\u00A0": // Non-breaking space
					return " "
				case "\u200B": // Zero-width space
				case "\u200C": // Zero-width non-joiner
				case "\u200D": // Zero-width joiner
					return ""
				case "\u2018": // Left single quotation mark
				case "\u2019": // Right single quotation mark
					return "'"
				case "\u201C": // Left double quotation mark
				case "\u201D": // Right double quotation mark
					return '"'
				default: // Dash characters (U+2010 through U+2015, U+2212)
					return "-"
			}
		})
	}

	/**
	 * Parse YAML content with enhanced error handling and preprocessing
	 */
	private parseYamlSafely(content: string, filePath: string): any {
		// Clean the content
		let cleanedContent = stripBom(content)
		cleanedContent = this.cleanInvisibleCharacters(cleanedContent)

		try {
			return yaml.parse(cleanedContent)
		} catch (yamlError) {
			// For .roomodes files, try JSON as fallback
			if (filePath.endsWith(ROOMODES_FILENAME)) {
				try {
					// Try parsing the original content as JSON (not the cleaned content)
					return JSON.parse(content)
				} catch (jsonError) {
					// JSON also failed, show the original YAML error
					const errorMsg = yamlError instanceof Error ? yamlError.message : String(yamlError)
					console.error(`[CustomModesManager] Failed to parse YAML from ${filePath}:`, errorMsg)

					const lineMatch = errorMsg.match(/at line (\d+)/)
					const line = lineMatch ? lineMatch[1] : "unknown"
					vscode.window.showErrorMessage(t("common:customModes.errors.yamlParseError", { line }))

					// Return empty object to prevent duplicate error handling
					return {}
				}
			}

			// For non-.roomodes files, just log and return empty object
			const errorMsg = yamlError instanceof Error ? yamlError.message : String(yamlError)
			console.error(`[CustomModesManager] Failed to parse YAML from ${filePath}:`, errorMsg)
			return {}
		}
	}

	private async loadModesFromFile(filePath: string): Promise<ModeConfig[]> {
		try {
			const content = await fs.readFile(filePath, "utf-8")
			const settings = this.parseYamlSafely(content, filePath)
			const result = customModesSettingsSchema.safeParse(settings)

			if (!result.success) {
				console.error(`[CustomModesManager] Schema validation failed for ${filePath}:`, result.error)

				// Show user-friendly error for .roomodes files
				if (filePath.endsWith(ROOMODES_FILENAME)) {
					const issues = result.error.issues
						.map((issue) => `• ${issue.path.join(".")}: ${issue.message}`)
						.join("\n")

					vscode.window.showErrorMessage(t("common:customModes.errors.schemaValidationError", { issues }))
				}

				return []
			}

			// Determine source based on file path
			const isRoomodes = filePath.endsWith(ROOMODES_FILENAME)
			const source = isRoomodes ? ("project" as const) : ("global" as const)

			// Add source to each mode
			return result.data.customModes.map((mode) => ({ ...mode, source }))
		} catch (error) {
			// Only log if the error wasn't already handled in parseYamlSafely
			if (!(error as any).alreadyHandled) {
				const errorMsg = `Failed to load modes from ${filePath}: ${error instanceof Error ? error.message : String(error)}`
				console.error(`[CustomModesManager] ${errorMsg}`)
			}
			return []
		}
	}

	private async mergeCustomModes(projectModes: ModeConfig[], globalModes: ModeConfig[]): Promise<ModeConfig[]> {
		const slugs = new Set<string>()
		const merged: ModeConfig[] = []

		// Add project mode (takes precedence)
		for (const mode of projectModes) {
			if (!slugs.has(mode.slug)) {
				slugs.add(mode.slug)
				merged.push({ ...mode, source: "project" })
			}
		}

		// Add non-duplicate global modes
		for (const mode of globalModes) {
			if (!slugs.has(mode.slug)) {
				slugs.add(mode.slug)
				merged.push({ ...mode, source: "global" })
			}
		}

		return merged
	}

	public async getCustomModesFilePath(): Promise<string> {
		const settingsDir = await ensureSettingsDirectoryExists(this.context)
		const filePath = path.join(settingsDir, GlobalFileNames.customModes)
		const fileExists = await fileExistsAtPath(filePath)

		if (!fileExists) {
			await this.queueWrite(() => fs.writeFile(filePath, yaml.stringify({ customModes: [] }, { lineWidth: 0 })))
		}

		return filePath
	}

	private async watchCustomModesFiles(): Promise<void> {
		// Skip if test environment is detected
		if (process.env.NODE_ENV === "test") {
			return
		}

		const settingsPath = await this.getCustomModesFilePath()

		// Watch settings file
		const settingsWatcher = vscode.workspace.createFileSystemWatcher(settingsPath)

		const handleSettingsChange = async () => {
			try {
				// Ensure that the settings file exists (especially important for delete events)
				await this.getCustomModesFilePath()
				const content = await fs.readFile(settingsPath, "utf-8")

				const errorMessage = t("common:customModes.errors.invalidFormat")

				let config: any

				try {
					config = this.parseYamlSafely(content, settingsPath)
				} catch (error) {
					console.error(error)
					vscode.window.showErrorMessage(errorMessage)
					return
				}

				const result = customModesSettingsSchema.safeParse(config)

				if (!result.success) {
					vscode.window.showErrorMessage(errorMessage)
					return
				}

				// Get modes from .roomodes if it exists (takes precedence)
				const roomodesPath = await this.getWorkspaceRoomodes()
				const roomodesModes = roomodesPath ? await this.loadModesFromFile(roomodesPath) : []

				// Merge modes from both sources (.roomodes takes precedence)
				const mergedModes = await this.mergeCustomModes(roomodesModes, result.data.customModes)
				await this.context.globalState.update("customModes", mergedModes)
				this.clearCache()
				await this.onUpdate()
			} catch (error) {
				console.error(`[CustomModesManager] Error handling settings file change:`, error)
			}
		}

		this.disposables.push(settingsWatcher.onDidChange(handleSettingsChange))
		this.disposables.push(settingsWatcher.onDidCreate(handleSettingsChange))
		this.disposables.push(settingsWatcher.onDidDelete(handleSettingsChange))
		this.disposables.push(settingsWatcher)

		// Watch .roomodes file - watch the path even if it doesn't exist yet
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (workspaceFolders && workspaceFolders.length > 0) {
			const workspaceRoot = getWorkspacePath()
			const roomodesPath = path.join(workspaceRoot, ROOMODES_FILENAME)
			const roomodesWatcher = vscode.workspace.createFileSystemWatcher(roomodesPath)

			const handleRoomodesChange = async () => {
				try {
					const settingsModes = await this.loadModesFromFile(settingsPath)
					const roomodesModes = await this.loadModesFromFile(roomodesPath)
					// .roomodes takes precedence
					const mergedModes = await this.mergeCustomModes(roomodesModes, settingsModes)
					await this.context.globalState.update("customModes", mergedModes)
					this.clearCache()
					await this.onUpdate()
				} catch (error) {
					console.error(`[CustomModesManager] Error handling .roomodes file change:`, error)
				}
			}

			this.disposables.push(roomodesWatcher.onDidChange(handleRoomodesChange))
			this.disposables.push(roomodesWatcher.onDidCreate(handleRoomodesChange))
			this.disposables.push(
				roomodesWatcher.onDidDelete(async () => {
					// When .roomodes is deleted, refresh with only settings modes
					try {
						const settingsModes = await this.loadModesFromFile(settingsPath)
						await this.context.globalState.update("customModes", settingsModes)
						this.clearCache()
						await this.onUpdate()
					} catch (error) {
						console.error(`[CustomModesManager] Error handling .roomodes file deletion:`, error)
					}
				}),
			)
			this.disposables.push(roomodesWatcher)
		}
	}

	public async getCustomModes(): Promise<ModeConfig[]> {
		// Check if we have a valid cached result.
		const now = Date.now()

		if (this.cachedModes && now - this.cachedAt < CustomModesManager.cacheTTL) {
			return this.cachedModes
		}

		// Get modes from settings file.
		const settingsPath = await this.getCustomModesFilePath()
		const settingsModes = await this.loadModesFromFile(settingsPath)

		// Get modes from .roomodes if it exists.
		const roomodesPath = await this.getWorkspaceRoomodes()
		const roomodesModes = roomodesPath ? await this.loadModesFromFile(roomodesPath) : []

		// Create maps to store modes by source.
		const projectModes = new Map<string, ModeConfig>()
		const globalModes = new Map<string, ModeConfig>()

		// Add project modes (they take precedence).
		for (const mode of roomodesModes) {
			projectModes.set(mode.slug, { ...mode, source: "project" as const })
		}

		// Add global modes.
		for (const mode of settingsModes) {
			if (!projectModes.has(mode.slug)) {
				globalModes.set(mode.slug, { ...mode, source: "global" as const })
			}
		}

		// Combine modes in the correct order: project modes first, then global modes.
		const mergedModes = [
			...roomodesModes.map((mode) => ({ ...mode, source: "project" as const })),
			...settingsModes
				.filter((mode) => !projectModes.has(mode.slug))
				.map((mode) => ({ ...mode, source: "global" as const })),
		]

		await this.context.globalState.update("customModes", mergedModes)

		this.cachedModes = mergedModes
		this.cachedAt = now

		return mergedModes
	}

	public async updateCustomMode(slug: string, config: ModeConfig): Promise<void> {
		try {
			const isProjectMode = config.source === "project"
			let targetPath: string

			if (isProjectMode) {
				const workspaceFolders = vscode.workspace.workspaceFolders

				if (!workspaceFolders || workspaceFolders.length === 0) {
					logger.error("Failed to update project mode: No workspace folder found", { slug })
					throw new Error(t("common:customModes.errors.noWorkspaceForProject"))
				}

				const workspaceRoot = getWorkspacePath()
				targetPath = path.join(workspaceRoot, ROOMODES_FILENAME)
				const exists = await fileExistsAtPath(targetPath)

				logger.info(`${exists ? "Updating" : "Creating"} project mode in ${ROOMODES_FILENAME}`, {
					slug,
					workspace: workspaceRoot,
				})
			} else {
				targetPath = await this.getCustomModesFilePath()
			}

			await this.queueWrite(async () => {
				// Ensure source is set correctly based on target file.
				const modeWithSource = {
					...config,
					source: isProjectMode ? ("project" as const) : ("global" as const),
				}

				await this.updateModesInFile(targetPath, (modes) => {
					const updatedModes = modes.filter((m) => m.slug !== slug)
					updatedModes.push(modeWithSource)
					return updatedModes
				})

				this.clearCache()
				await this.refreshMergedState()
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("Failed to update custom mode", { slug, error: errorMessage })
			vscode.window.showErrorMessage(t("common:customModes.errors.updateFailed", { error: errorMessage }))
		}
	}

	private async updateModesInFile(filePath: string, operation: (modes: ModeConfig[]) => ModeConfig[]): Promise<void> {
		let content = "{}"

		try {
			content = await fs.readFile(filePath, "utf-8")
		} catch (error) {
			// File might not exist yet.
			content = yaml.stringify({ customModes: [] }, { lineWidth: 0 })
		}

		let settings

		try {
			settings = this.parseYamlSafely(content, filePath)
		} catch (error) {
			// Error already logged in parseYamlSafely
			settings = { customModes: [] }
		}

		settings.customModes = operation(settings.customModes || [])
		await fs.writeFile(filePath, yaml.stringify(settings, { lineWidth: 0 }), "utf-8")
	}

	private async refreshMergedState(): Promise<void> {
		const settingsPath = await this.getCustomModesFilePath()
		const roomodesPath = await this.getWorkspaceRoomodes()

		const settingsModes = await this.loadModesFromFile(settingsPath)
		const roomodesModes = roomodesPath ? await this.loadModesFromFile(roomodesPath) : []
		const mergedModes = await this.mergeCustomModes(roomodesModes, settingsModes)

		await this.context.globalState.update("customModes", mergedModes)

		this.clearCache()

		await this.onUpdate()
	}

	public async deleteCustomMode(slug: string): Promise<void> {
		try {
			const settingsPath = await this.getCustomModesFilePath()
			const roomodesPath = await this.getWorkspaceRoomodes()

			const settingsModes = await this.loadModesFromFile(settingsPath)
			const roomodesModes = roomodesPath ? await this.loadModesFromFile(roomodesPath) : []

			// Find the mode in either file
			const projectMode = roomodesModes.find((m) => m.slug === slug)
			const globalMode = settingsModes.find((m) => m.slug === slug)

			if (!projectMode && !globalMode) {
				throw new Error(t("common:customModes.errors.modeNotFound"))
			}

			await this.queueWrite(async () => {
				// Delete from project first if it exists there
				if (projectMode && roomodesPath) {
					await this.updateModesInFile(roomodesPath, (modes) => modes.filter((m) => m.slug !== slug))
				}

				// Delete from global settings if it exists there
				if (globalMode) {
					await this.updateModesInFile(settingsPath, (modes) => modes.filter((m) => m.slug !== slug))
				}

				// Clear cache when modes are deleted
				this.clearCache()
				await this.refreshMergedState()
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			vscode.window.showErrorMessage(t("common:customModes.errors.deleteFailed", { error: errorMessage }))
		}
	}

	public async resetCustomModes(): Promise<void> {
		try {
			const filePath = await this.getCustomModesFilePath()
			await fs.writeFile(filePath, yaml.stringify({ customModes: [] }, { lineWidth: 0 }))
			await this.context.globalState.update("customModes", [])
			this.clearCache()
			await this.onUpdate()
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			vscode.window.showErrorMessage(t("common:customModes.errors.resetFailed", { error: errorMessage }))
		}
	}

	/**
	 * Checks if a mode has associated rules files in the .roo/rules-{slug}/ directory
	 * @param slug - The mode identifier to check
	 * @returns True if the mode has rules files with content, false otherwise
	 */
	public async checkRulesDirectoryHasContent(slug: string): Promise<boolean> {
		try {
			// Get workspace path
			const workspacePath = getWorkspacePath()
			if (!workspacePath) {
				return false
			}

			// Check if .roomodes file exists and contains this mode
			// This ensures we can only consolidate rules for modes that have been customized
			const roomodesPath = path.join(workspacePath, ROOMODES_FILENAME)
			try {
				const roomodesExists = await fileExistsAtPath(roomodesPath)
				if (roomodesExists) {
					const roomodesContent = await fs.readFile(roomodesPath, "utf-8")
					const roomodesData = yaml.parse(roomodesContent)
					const roomodesModes = roomodesData?.customModes || []

					// Check if this specific mode exists in .roomodes
					const modeInRoomodes = roomodesModes.find((m: any) => m.slug === slug)
					if (!modeInRoomodes) {
						return false // Mode not customized in .roomodes, cannot consolidate
					}
				} else {
					// If no .roomodes file exists, check if it's in global custom modes
					const allModes = await this.getCustomModes()
					const mode = allModes.find((m) => m.slug === slug)

					if (!mode) {
						return false // Not a custom mode, cannot consolidate
					}
				}
			} catch (error) {
				// If we can't read .roomodes, fall back to checking custom modes
				const allModes = await this.getCustomModes()
				const mode = allModes.find((m) => m.slug === slug)

				if (!mode) {
					return false // Not a custom mode, cannot consolidate
				}
			}

			// Check for .roo/rules-{slug}/ directory
			const modeRulesDir = path.join(workspacePath, ".roo", `rules-${slug}`)

			try {
				const stats = await fs.stat(modeRulesDir)
				if (!stats.isDirectory()) {
					return false
				}
			} catch (error) {
				return false
			}

			// Check if directory has any content files
			try {
				const entries = await fs.readdir(modeRulesDir, { withFileTypes: true })

				for (const entry of entries) {
					if (entry.isFile()) {
						// Use path.join with modeRulesDir and entry.name for compatibility
						const filePath = path.join(modeRulesDir, entry.name)
						const content = await fs.readFile(filePath, "utf-8")
						if (content.trim()) {
							return true // Found at least one file with content
						}
					}
				}

				return false // No files with content found
			} catch (error) {
				return false
			}
		} catch (error) {
			logger.error("Failed to check rules directory for mode", {
				slug,
				error: error instanceof Error ? error.message : String(error),
			})
			return false
		}
	}

	/**
	 * Exports a mode configuration with its associated rules files into a shareable YAML format
	 * @param slug - The mode identifier to export
	 * @param customPrompts - Optional custom prompts to merge into the export
	 * @returns Success status with YAML content or error message
	 */
	public async exportModeWithRules(slug: string, customPrompts?: PromptComponent): Promise<ExportResult> {
		try {
			// Import modes from shared to check built-in modes
			const { modes: builtInModes } = await import("../../shared/modes")

			// Get all current modes
			const allModes = await this.getCustomModes()
			let mode = allModes.find((m) => m.slug === slug)

			// If mode not found in custom modes, check if it's a built-in mode that has been customized
			if (!mode) {
				const workspacePath = getWorkspacePath()
				if (!workspacePath) {
					return { success: false, error: "No workspace found" }
				}

				const roomodesPath = path.join(workspacePath, ROOMODES_FILENAME)
				try {
					const roomodesExists = await fileExistsAtPath(roomodesPath)
					if (roomodesExists) {
						const roomodesContent = await fs.readFile(roomodesPath, "utf-8")
						const roomodesData = yaml.parse(roomodesContent)
						const roomodesModes = roomodesData?.customModes || []

						// Find the mode in .roomodes
						mode = roomodesModes.find((m: any) => m.slug === slug)
					}
				} catch (error) {
					// Continue to check built-in modes
				}

				// If still not found, check if it's a built-in mode
				if (!mode) {
					const builtInMode = builtInModes.find((m) => m.slug === slug)
					if (builtInMode) {
						// Use the built-in mode as the base
						mode = { ...builtInMode }
					} else {
						return { success: false, error: "Mode not found" }
					}
				}
			}

			// Get workspace path
			const workspacePath = getWorkspacePath()
			if (!workspacePath) {
				return { success: false, error: "No workspace found" }
			}

			// Check for .roo/rules-{slug}/ directory
			const modeRulesDir = path.join(workspacePath, ".roo", `rules-${slug}`)

			let rulesFiles: RuleFile[] = []
			try {
				const stats = await fs.stat(modeRulesDir)
				if (stats.isDirectory()) {
					// Extract content specific to this mode by looking for the mode-specific rules
					const entries = await fs.readdir(modeRulesDir, { withFileTypes: true })

					for (const entry of entries) {
						if (entry.isFile()) {
							// Use path.join with modeRulesDir and entry.name for compatibility
							const filePath = path.join(modeRulesDir, entry.name)
							const content = await fs.readFile(filePath, "utf-8")
							if (content.trim()) {
								// Calculate relative path from .roo directory
								const relativePath = path.relative(path.join(workspacePath, ".roo"), filePath)
								rulesFiles.push({ relativePath, content: content.trim() })
							}
						}
					}
				}
			} catch (error) {
				// Directory doesn't exist, which is fine - mode might not have rules
			}

			// Create an export mode with rules files preserved
			const exportMode: ExportedModeConfig = {
				...mode,
				// Remove source property for export
				source: "project" as const,
			}

			// Merge custom prompts if provided
			if (customPrompts) {
				if (customPrompts.roleDefinition) exportMode.roleDefinition = customPrompts.roleDefinition
				if (customPrompts.description) exportMode.description = customPrompts.description
				if (customPrompts.whenToUse) exportMode.whenToUse = customPrompts.whenToUse
				if (customPrompts.customInstructions) exportMode.customInstructions = customPrompts.customInstructions
			}

			// Add rules files if any exist
			if (rulesFiles.length > 0) {
				exportMode.rulesFiles = rulesFiles
			}

			// Generate YAML
			const exportData = {
				customModes: [exportMode],
			}

			const yamlContent = yaml.stringify(exportData)

			return { success: true, yaml: yamlContent }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("Failed to export mode with rules", { slug, error: errorMessage })
			return { success: false, error: errorMessage }
		}
	}

	/**
	 * Imports modes from YAML content, including their associated rules files
	 * @param yamlContent - The YAML content containing mode configurations
	 * @param source - Target level for import: "global" (all projects) or "project" (current workspace only)
	 * @returns Success status with optional error message
	 */
	public async importModeWithRules(
		yamlContent: string,
		source: "global" | "project" = "project",
	): Promise<ImportResult> {
		try {
			// Parse the YAML content with proper type validation
			let importData: ImportData
			try {
				const parsed = yaml.parse(yamlContent)

				// Validate the structure
				if (!parsed?.customModes || !Array.isArray(parsed.customModes) || parsed.customModes.length === 0) {
					return { success: false, error: "Invalid import format: Expected 'customModes' array in YAML" }
				}

				importData = parsed as ImportData
			} catch (parseError) {
				return {
					success: false,
					error: `Invalid YAML format: ${parseError instanceof Error ? parseError.message : "Failed to parse YAML"}`,
				}
			}

			// Check workspace availability early if importing at project level
			if (source === "project") {
				const workspacePath = getWorkspacePath()
				if (!workspacePath) {
					return { success: false, error: "No workspace found" }
				}
			}

			// Process each mode in the import
			for (const importMode of importData.customModes) {
				const { rulesFiles, ...modeConfig } = importMode

				// Validate the mode configuration
				const validationResult = modeConfigSchema.safeParse(modeConfig)
				if (!validationResult.success) {
					logger.error(`Invalid mode configuration for ${modeConfig.slug}`, {
						errors: validationResult.error.errors,
					})
					return {
						success: false,
						error: `Invalid mode configuration for ${modeConfig.slug}: ${validationResult.error.errors.map((e) => e.message).join(", ")}`,
					}
				}

				// Check for existing mode conflicts
				const existingModes = await this.getCustomModes()
				const existingMode = existingModes.find((m) => m.slug === importMode.slug)
				if (existingMode) {
					logger.info(`Overwriting existing mode: ${importMode.slug}`)
				}

				// Import the mode configuration with the specified source
				await this.updateCustomMode(importMode.slug, {
					...modeConfig,
					source: source, // Use the provided source parameter
				})

				// Handle project-level imports
				if (source === "project") {
					const workspacePath = getWorkspacePath()

					// Always remove the existing rules folder for this mode if it exists
					// This ensures that if the imported mode has no rules, the folder is cleaned up
					const rulesFolderPath = path.join(workspacePath, ".roo", `rules-${importMode.slug}`)
					try {
						await fs.rm(rulesFolderPath, { recursive: true, force: true })
						logger.info(`Removed existing rules folder for mode ${importMode.slug}`)
					} catch (error) {
						// It's okay if the folder doesn't exist
						logger.debug(`No existing rules folder to remove for mode ${importMode.slug}`)
					}

					// Only create new rules files if they exist in the import
					if (rulesFiles && Array.isArray(rulesFiles) && rulesFiles.length > 0) {
						// Import the new rules files with path validation
						for (const ruleFile of rulesFiles) {
							if (ruleFile.relativePath && ruleFile.content) {
								// Validate the relative path to prevent path traversal attacks
								const normalizedRelativePath = path.normalize(ruleFile.relativePath)

								// Ensure the path doesn't contain traversal sequences
								if (normalizedRelativePath.includes("..") || path.isAbsolute(normalizedRelativePath)) {
									logger.error(`Invalid file path detected: ${ruleFile.relativePath}`)
									continue // Skip this file but continue with others
								}

								const targetPath = path.join(workspacePath, ".roo", normalizedRelativePath)
								const normalizedTargetPath = path.normalize(targetPath)
								const expectedBasePath = path.normalize(path.join(workspacePath, ".roo"))

								// Ensure the resolved path stays within the .roo directory
								if (!normalizedTargetPath.startsWith(expectedBasePath)) {
									logger.error(`Path traversal attempt detected: ${ruleFile.relativePath}`)
									continue // Skip this file but continue with others
								}

								// Ensure directory exists
								const targetDir = path.dirname(targetPath)
								await fs.mkdir(targetDir, { recursive: true })

								// Write the file
								await fs.writeFile(targetPath, ruleFile.content, "utf-8")
							}
						}
					}
				} else if (source === "global" && rulesFiles && Array.isArray(rulesFiles)) {
					// For global imports, preserve the rules files structure in the global .roo directory
					const globalRooDir = getGlobalRooDirectory()

					// Always remove the existing rules folder for this mode if it exists
					// This ensures that if the imported mode has no rules, the folder is cleaned up
					const rulesFolderPath = path.join(globalRooDir, `rules-${importMode.slug}`)
					try {
						await fs.rm(rulesFolderPath, { recursive: true, force: true })
						logger.info(`Removed existing global rules folder for mode ${importMode.slug}`)
					} catch (error) {
						// It's okay if the folder doesn't exist
						logger.debug(`No existing global rules folder to remove for mode ${importMode.slug}`)
					}

					// Import the new rules files with path validation
					for (const ruleFile of rulesFiles) {
						if (ruleFile.relativePath && ruleFile.content) {
							// Validate the relative path to prevent path traversal attacks
							const normalizedRelativePath = path.normalize(ruleFile.relativePath)

							// Ensure the path doesn't contain traversal sequences
							if (normalizedRelativePath.includes("..") || path.isAbsolute(normalizedRelativePath)) {
								logger.error(`Invalid file path detected: ${ruleFile.relativePath}`)
								continue // Skip this file but continue with others
							}

							const targetPath = path.join(globalRooDir, normalizedRelativePath)
							const normalizedTargetPath = path.normalize(targetPath)
							const expectedBasePath = path.normalize(globalRooDir)

							// Ensure the resolved path stays within the global .roo directory
							if (!normalizedTargetPath.startsWith(expectedBasePath)) {
								logger.error(`Path traversal attempt detected: ${ruleFile.relativePath}`)
								continue // Skip this file but continue with others
							}

							// Ensure directory exists
							const targetDir = path.dirname(targetPath)
							await fs.mkdir(targetDir, { recursive: true })

							// Write the file
							await fs.writeFile(targetPath, ruleFile.content, "utf-8")
						}
					}
				}
			}

			// Refresh the modes after import
			await this.refreshMergedState()

			return { success: true }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("Failed to import mode with rules", { error: errorMessage })
			return { success: false, error: errorMessage }
		}
	}

	private clearCache(): void {
		this.cachedModes = null
		this.cachedAt = 0
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose()
		}

		this.disposables = []
	}
}
