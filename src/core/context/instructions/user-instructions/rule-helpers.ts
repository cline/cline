import { ensureRulesDirectoryExists, ensureWorkflowsDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ClineRulesToggles } from "@shared/cline-rules"
import { GlobalInstructionsFile } from "@shared/remote-config/schema"
import { fileExistsAtPath, isDirectory, readDirectory } from "@utils/fs"
import fs from "fs/promises"
import * as path from "path"
import { Controller } from "@/core/controller"

/**
 * Recursively traverses directory and finds all files, including checking for optional whitelisted file extension
 */
export async function readDirectoryRecursive(
	directoryPath: string,
	allowedFileExtension: string,
	excludedPaths: string[][] = [],
): Promise<string[]> {
	try {
		const entries = await readDirectory(directoryPath, excludedPaths)
		const results: string[] = []
		for (const entry of entries) {
			if (allowedFileExtension !== "") {
				const fileExtension = path.extname(entry)
				if (fileExtension !== allowedFileExtension) {
					continue
				}
			}
			results.push(entry)
		}
		return results
	} catch (error) {
		console.error(`Error reading directory ${directoryPath}: ${error}`)
		return []
	}
}

/**
 * Gets the up to date toggles
 */
export async function synchronizeRuleToggles(
	rulesDirectoryPath: string,
	currentToggles: ClineRulesToggles,
	allowedFileExtension: string = "",
	excludedPaths: string[][] = [],
): Promise<ClineRulesToggles> {
	// Create a copy of toggles to modify
	const updatedToggles = { ...currentToggles }

	try {
		const pathExists = await fileExistsAtPath(rulesDirectoryPath)

		if (pathExists) {
			const isDir = await isDirectory(rulesDirectoryPath)

			if (isDir) {
				// DIRECTORY CASE
				const filePaths = await readDirectoryRecursive(rulesDirectoryPath, allowedFileExtension, excludedPaths)
				const existingRulePaths = new Set<string>()

				for (const filePath of filePaths) {
					const ruleFilePath = path.resolve(rulesDirectoryPath, filePath)
					existingRulePaths.add(ruleFilePath)

					const pathHasToggle = ruleFilePath in updatedToggles
					if (!pathHasToggle) {
						updatedToggles[ruleFilePath] = true
					}
				}

				// Clean up toggles for non-existent files
				for (const togglePath in updatedToggles) {
					const pathExists = existingRulePaths.has(togglePath)
					if (!pathExists) {
						delete updatedToggles[togglePath]
					}
				}
			} else {
				// FILE CASE
				// Add toggle for this file
				const pathHasToggle = rulesDirectoryPath in updatedToggles
				if (!pathHasToggle) {
					updatedToggles[rulesDirectoryPath] = true
				}

				// Remove toggles for any other paths
				for (const togglePath in updatedToggles) {
					if (togglePath !== rulesDirectoryPath) {
						delete updatedToggles[togglePath]
					}
				}
			}
		} else {
			// PATH DOESN'T EXIST CASE
			// Clear all toggles since the path doesn't exist
			for (const togglePath in updatedToggles) {
				delete updatedToggles[togglePath]
			}
		}
	} catch (error) {
		console.error(`Failed to synchronize rule toggles for path: ${rulesDirectoryPath}`, error)
	}

	return updatedToggles
}

/**
 * Synchronizes remote rule toggles with current remote config
 * Removes toggles for rules that no longer exist, adds defaults for new rules
 */
export function synchronizeRemoteRuleToggles(
	remoteRules: GlobalInstructionsFile[],
	currentToggles: ClineRulesToggles,
): ClineRulesToggles {
	const updatedToggles: ClineRulesToggles = {}

	// Create set of current remote rule names
	const existingRuleNames = new Set(remoteRules.map((rule) => rule.name))

	// Keep toggles only for rules that still exist
	for (const [ruleName, enabled] of Object.entries(currentToggles)) {
		if (existingRuleNames.has(ruleName)) {
			updatedToggles[ruleName] = enabled
		}
	}

	// Add default toggles for new rules (default to enabled)
	for (const rule of remoteRules) {
		if (!(rule.name in updatedToggles)) {
			updatedToggles[rule.name] = true
		}
	}

	return updatedToggles
}

/**
 * Certain project rules have more than a single location where rules are allowed to be stored
 */
export function combineRuleToggles(toggles1: ClineRulesToggles, toggles2: ClineRulesToggles): ClineRulesToggles {
	return { ...toggles1, ...toggles2 }
}

/**
 * Read the content of rules files
 */
export const getRuleFilesTotalContent = async (rulesFilePaths: string[], basePath: string, toggles: ClineRulesToggles) => {
	const ruleFilesTotalContent = await Promise.all(
		rulesFilePaths.map(async (filePath) => {
			const ruleFilePath = path.resolve(basePath, filePath)
			const ruleFilePathRelative = path.relative(basePath, ruleFilePath)

			if (ruleFilePath in toggles && toggles[ruleFilePath] === false) {
				return null
			}

			return `${ruleFilePathRelative}\n` + (await fs.readFile(ruleFilePath, "utf8")).trim()
		}),
	).then((contents) => contents.filter(Boolean).join("\n\n"))
	return ruleFilesTotalContent
}

/**
 * Handles converting any directory into a file (specifically used for .clinerules and .clinerules/workflows)
 * The old .clinerules file or .clinerules/workflows file will be renamed to a default filename
 * Doesn't do anything if the dir already exists or doesn't exist
 * Returns whether there are any uncaught errors
 */
export async function ensureLocalClineDirExists(clinerulePath: string, defaultRuleFilename: string): Promise<boolean> {
	try {
		const exists = await fileExistsAtPath(clinerulePath)

		if (exists && !(await isDirectory(clinerulePath))) {
			// logic to convert .clinerules file into directory, and rename the rules file to {defaultRuleFilename}
			const content = await fs.readFile(clinerulePath, "utf8")
			const tempPath = clinerulePath + ".bak"
			await fs.rename(clinerulePath, tempPath) // create backup
			try {
				await fs.mkdir(clinerulePath, { recursive: true })
				await fs.writeFile(path.join(clinerulePath, defaultRuleFilename), content, "utf8")
				await fs.unlink(tempPath).catch(() => {}) // delete backup

				return false // conversion successful with no errors
			} catch (_conversionError) {
				// attempt to restore backup on conversion failure
				try {
					await fs.rm(clinerulePath, { recursive: true, force: true }).catch(() => {})
					await fs.rename(tempPath, clinerulePath) // restore backup
				} catch (_restoreError) {}
				return true // in either case here we consider this an error
			}
		}
		// exists and is a dir or doesn't exist, either of these cases we dont need to handle here
		return false
	} catch (_error) {
		return true
	}
}

/**
 * Create a rule file or workflow file
 */
export const createRuleFile = async (isGlobal: boolean, filename: string, cwd: string, type: string) => {
	try {
		let filePath: string
		if (isGlobal) {
			if (type === "workflow") {
				const globalClineWorkflowFilePath = await ensureWorkflowsDirectoryExists()
				filePath = path.join(globalClineWorkflowFilePath, filename)
			} else {
				const globalClineRulesFilePath = await ensureRulesDirectoryExists()
				filePath = path.join(globalClineRulesFilePath, filename)
			}
		} else {
			const localClineRulesFilePath = path.resolve(cwd, GlobalFileNames.clineRules)

			const hasError = await ensureLocalClineDirExists(localClineRulesFilePath, "default-rules.md")
			if (hasError === true) {
				return { filePath: null, fileExists: false }
			}

			await fs.mkdir(localClineRulesFilePath, { recursive: true })

			if (type === "workflow") {
				const localWorkflowsFilePath = path.resolve(cwd, GlobalFileNames.workflows)

				const hasError = await ensureLocalClineDirExists(localWorkflowsFilePath, "default-workflows.md")
				if (hasError === true) {
					return { filePath: null, fileExists: false }
				}

				await fs.mkdir(localWorkflowsFilePath, { recursive: true })

				filePath = path.join(localWorkflowsFilePath, filename)
			} else {
				// clinerules file creation
				filePath = path.join(localClineRulesFilePath, filename)
			}
		}

		const fileExists = await fileExistsAtPath(filePath)

		if (fileExists) {
			return { filePath, fileExists }
		}

		await fs.writeFile(filePath, "", "utf8")

		return { filePath, fileExists: false }
	} catch (_error) {
		return { filePath: null, fileExists: false }
	}
}

/**
 * Delete a rule file or workflow file
 */
export async function deleteRuleFile(
	controller: Controller,
	rulePath: string,
	isGlobal: boolean,
	type: string,
): Promise<{ success: boolean; message: string }> {
	try {
		// Check if file exists
		const fileExists = await fileExistsAtPath(rulePath)
		if (!fileExists) {
			return {
				success: false,
				message: `File does not exist: ${rulePath}`,
			}
		}

		// Delete the file from disk
		await fs.rm(rulePath, { force: true })

		// Get the filename for messages
		const fileName = path.basename(rulePath)

		// Update the appropriate toggles
		if (isGlobal) {
			if (type === "workflow") {
				const toggles = controller.stateManager.getGlobalSettingsKey("globalWorkflowToggles")
				delete toggles[rulePath]
				controller.stateManager.setGlobalState("globalWorkflowToggles", toggles)
			} else {
				const toggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
				delete toggles[rulePath]
				controller.stateManager.setGlobalState("globalClineRulesToggles", toggles)
			}
		} else {
			if (type === "workflow") {
				const toggles = controller.stateManager.getWorkspaceStateKey("workflowToggles")
				delete toggles[rulePath]
				controller.stateManager.setWorkspaceState("workflowToggles", toggles)
			} else if (type === "cursor") {
				const toggles = controller.stateManager.getWorkspaceStateKey("localCursorRulesToggles")
				delete toggles[rulePath]
				controller.stateManager.setWorkspaceState("localCursorRulesToggles", toggles)
			} else if (type === "windsurf") {
				const toggles = controller.stateManager.getWorkspaceStateKey("localWindsurfRulesToggles")
				delete toggles[rulePath]
				controller.stateManager.setWorkspaceState("localWindsurfRulesToggles", toggles)
			} else if (type === "agents") {
				const toggles = controller.stateManager.getWorkspaceStateKey("localAgentsRulesToggles")
				delete toggles[rulePath]
				controller.stateManager.setWorkspaceState("localAgentsRulesToggles", toggles)
			} else {
				const toggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
				delete toggles[rulePath]
				controller.stateManager.setWorkspaceState("localClineRulesToggles", toggles)
			}
		}

		return {
			success: true,
			message: `File "${fileName}" deleted successfully`,
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		console.error(`Error deleting file: ${errorMessage}`, error)
		return {
			success: false,
			message: `Failed to delete file.`,
		}
	}
}
