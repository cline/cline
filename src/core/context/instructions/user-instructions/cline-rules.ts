import path from "path"
import { ensureRulesDirectoryExists, GlobalFileNames } from "../../../storage/disk"
import { fileExistsAtPath, isDirectory, readDirectory } from "../../../../utils/fs"
import { formatResponse } from "../../../prompts/responses"
import fs from "fs/promises"
import { ClineRulesToggles } from "../../../../shared/cline-rules"
import { getGlobalState, getWorkspaceState, updateGlobalState, updateWorkspaceState } from "../../../storage/state"
import * as vscode from "vscode"

export const getGlobalClineRules = async (globalClineRulesFilePath: string, toggles: ClineRulesToggles) => {
	if (await fileExistsAtPath(globalClineRulesFilePath)) {
		if (await isDirectory(globalClineRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(globalClineRulesFilePath)
				const rulesFilesTotalContent = await getClineRulesFilesTotalContent(
					rulesFilePaths,
					globalClineRulesFilePath,
					toggles,
				)
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
				const rulesFilesTotalContent = await getClineRulesFilesTotalContent(rulesFilePaths, cwd, toggles)
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

const getClineRulesFilesTotalContent = async (rulesFilePaths: string[], basePath: string, toggles: ClineRulesToggles) => {
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

export async function synchronizeRuleToggles(
	rulesDirectoryPath: string,
	currentToggles: ClineRulesToggles,
): Promise<ClineRulesToggles> {
	// Create a copy of toggles to modify
	const updatedToggles = { ...currentToggles }

	try {
		const pathExists = await fileExistsAtPath(rulesDirectoryPath)

		if (pathExists) {
			const isDir = await isDirectory(rulesDirectoryPath)

			if (isDir) {
				// DIRECTORY CASE
				const filePaths = await readDirectory(rulesDirectoryPath)
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

			// Check if there is an existing .clinerules file (We're trying to make it a directory)
			const pathExists = await fileExistsAtPath(localClineRulesFilePath)
			const isDir = pathExists ? await isDirectory(localClineRulesFilePath) : false

			if (pathExists && !isDir) {
				// A .clinerules file exists, migrate it to a directory
				try {
					const content = await fs.readFile(localClineRulesFilePath, "utf8")

					const tempDirPath = path.resolve(cwd, ".clinerules_temp")
					await fs.mkdir(tempDirPath, { recursive: true })

					await fs.writeFile(path.join(tempDirPath, "old_clinerules_file.md"), content, "utf8")

					await fs.unlink(localClineRulesFilePath)

					await fs.rename(tempDirPath, localClineRulesFilePath)
				} catch (error) {
					console.error("Failed to migrate .clinerules file to directory:", error)
					throw error
				}
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
