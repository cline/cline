import path from "path"
import { ensureRulesDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { fileExistsAtPath, isDirectory, readDirectory } from "@utils/fs"
import { formatResponse } from "@core/prompts/responses"
import fs from "fs/promises"
import { ClineRulesToggles } from "@shared/cline-rules"
import { getGlobalState, getWorkspaceState, updateGlobalState, updateWorkspaceState } from "@core/storage/state"
import * as vscode from "vscode"
import { synchronizeRuleToggles, getRuleFilesTotalContent } from "@core/context/instructions/user-instructions/rule-helpers"

/**
 * Converts .clinerules file to directory and places old .clinerule file inside directory, renaming it
 * Doesn't do anything if .clinerules dir already exists or doesn't exist
 * Returns whether there are any uncaught errors
 */
export async function ensureLocalClinerulesDirExists(cwd: string): Promise<boolean> {
	const clinerulePath = path.resolve(cwd, GlobalFileNames.clineRules)
	const defaultRuleFilename = "default-rules.md"

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
			} catch (conversionError) {
				// attempt to restore backup on conversion failure
				try {
					await fs.rm(clinerulePath, { recursive: true, force: true }).catch(() => {})
					await fs.rename(tempPath, clinerulePath) // restore backup
				} catch (restoreError) {}
				return true // in either case here we consider this an error
			}
		}
		// exists and is a dir or doesn't exist, either of these cases we dont need to handle here
		return false
	} catch (error) {
		return true
	}
}

export const getGlobalClineRules = async (globalClineRulesFilePath: string, toggles: ClineRulesToggles) => {
	if (await fileExistsAtPath(globalClineRulesFilePath)) {
		if (await isDirectory(globalClineRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(globalClineRulesFilePath)
				const rulesFilesTotalContent = await getRuleFilesTotalContent(rulesFilePaths, globalClineRulesFilePath, toggles)
				if (rulesFilesTotalContent) {
					const clineRulesFileInstructions = formatResponse.clineRulesGlobalDirectoryInstructions(
						globalClineRulesFilePath,
						rulesFilesTotalContent,
					)
					return clineRulesFileInstructions
				}
			} catch {
				console.error(`Failed to read .clinerules directory at ${globalClineRulesFilePath}`)
			}
		} else {
			console.error(`${globalClineRulesFilePath} is not a directory`)
			return undefined
		}
	}

	return undefined
}

export const getLocalClineRules = async (cwd: string, toggles: ClineRulesToggles) => {
	const clineRulesFilePath = path.resolve(cwd, GlobalFileNames.clineRules)

	let clineRulesFileInstructions: string | undefined

	if (await fileExistsAtPath(clineRulesFilePath)) {
		if (await isDirectory(clineRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(clineRulesFilePath)
				const rulesFilesTotalContent = await getRuleFilesTotalContent(rulesFilePaths, cwd, toggles)
				if (rulesFilesTotalContent) {
					clineRulesFileInstructions = formatResponse.clineRulesLocalDirectoryInstructions(cwd, rulesFilesTotalContent)
				}
			} catch {
				console.error(`Failed to read .clinerules directory at ${clineRulesFilePath}`)
			}
		} else {
			try {
				if (clineRulesFilePath in toggles && toggles[clineRulesFilePath] !== false) {
					const ruleFileContent = (await fs.readFile(clineRulesFilePath, "utf8")).trim()
					if (ruleFileContent) {
						clineRulesFileInstructions = formatResponse.clineRulesLocalFileInstructions(cwd, ruleFileContent)
					}
				}
			} catch {
				console.error(`Failed to read .clinerules file at ${clineRulesFilePath}`)
			}
		}
	}

	return clineRulesFileInstructions
}

export async function refreshClineRulesToggles(
	context: vscode.ExtensionContext,
	workingDirectory: string,
): Promise<{
	globalToggles: ClineRulesToggles
	localToggles: ClineRulesToggles
}> {
	// Global toggles
	const globalClineRulesToggles = ((await getGlobalState(context, "globalClineRulesToggles")) as ClineRulesToggles) || {}
	const globalClineRulesFilePath = await ensureRulesDirectoryExists()
	const updatedGlobalToggles = await synchronizeRuleToggles(globalClineRulesFilePath, globalClineRulesToggles)
	await updateGlobalState(context, "globalClineRulesToggles", updatedGlobalToggles)

	// Local toggles
	const localClineRulesToggles = ((await getWorkspaceState(context, "localClineRulesToggles")) as ClineRulesToggles) || {}
	const localClineRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.clineRules)
	const updatedLocalToggles = await synchronizeRuleToggles(localClineRulesFilePath, localClineRulesToggles)
	await updateWorkspaceState(context, "localClineRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}

export const createRuleFile = async (isGlobal: boolean, filename: string, cwd: string) => {
	try {
		let filePath: string
		if (isGlobal) {
			const globalClineRulesFilePath = await ensureRulesDirectoryExists()
			filePath = path.join(globalClineRulesFilePath, filename)
		} else {
			const localClineRulesFilePath = path.resolve(cwd, GlobalFileNames.clineRules)

			const hasError = await ensureLocalClinerulesDirExists(cwd)
			if (hasError === true) {
				return { filePath: null, fileExists: false }
			}

			await fs.mkdir(localClineRulesFilePath, { recursive: true })

			filePath = path.join(localClineRulesFilePath, filename)
		}

		const fileExists = await fileExistsAtPath(filePath)

		if (fileExists) {
			return { filePath, fileExists }
		}

		await fs.writeFile(filePath, "", "utf8")

		return { filePath, fileExists: false }
	} catch (error) {
		return { filePath: null, fileExists: false }
	}
}

export async function deleteRuleFile(
	context: vscode.ExtensionContext,
	rulePath: string,
	isGlobal: boolean,
): Promise<{ success: boolean; message: string }> {
	try {
		// Check if file exists
		const fileExists = await fileExistsAtPath(rulePath)
		if (!fileExists) {
			return {
				success: false,
				message: `Rule file does not exist: ${rulePath}`,
			}
		}

		// Delete the file from disk
		await fs.unlink(rulePath)

		// Get the filename for messages
		const fileName = path.basename(rulePath)

		// Update the appropriate toggles
		if (isGlobal) {
			const toggles = ((await getGlobalState(context, "globalClineRulesToggles")) as ClineRulesToggles) || {}
			delete toggles[rulePath]
			await updateGlobalState(context, "globalClineRulesToggles", toggles)
		} else {
			const toggles = ((await getWorkspaceState(context, "localClineRulesToggles")) as ClineRulesToggles) || {}
			delete toggles[rulePath]
			await updateWorkspaceState(context, "localClineRulesToggles", toggles)
		}

		return {
			success: true,
			message: `Rule file "${fileName}" deleted successfully`,
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		console.error(`Error deleting rule file: ${errorMessage}`, error)
		return {
			success: false,
			message: `Failed to delete rule file.`,
		}
	}
}
