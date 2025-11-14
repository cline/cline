import {
	combineRuleToggles,
	getRuleFilesTotalContent,
	readDirectoryRecursive,
	synchronizeRuleToggles,
} from "@core/context/instructions/user-instructions/rule-helpers"
import { formatResponse } from "@core/prompts/responses"
import { GlobalFileNames } from "@core/storage/disk"
import { listFiles } from "@services/glob/list-files"
import { ClineRulesToggles } from "@shared/cline-rules"
import { fileExistsAtPath, isDirectory } from "@utils/fs"
import fs from "fs/promises"
import path from "path"
import { Controller } from "@/core/controller"

/**
 * Refreshes the toggles for windsurf, cursor, and agents rules
 */
export async function refreshExternalRulesToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	windsurfLocalToggles: ClineRulesToggles
	cursorLocalToggles: ClineRulesToggles
	agentsLocalToggles: ClineRulesToggles
}> {
	// local windsurf toggles
	const localWindsurfRulesToggles = controller.stateManager.getWorkspaceStateKey("localWindsurfRulesToggles")
	const localWindsurfRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.windsurfRules)
	const updatedLocalWindsurfToggles = await synchronizeRuleToggles(localWindsurfRulesFilePath, localWindsurfRulesToggles)
	controller.stateManager.setWorkspaceState("localWindsurfRulesToggles", updatedLocalWindsurfToggles)

	// local cursor toggles
	const localCursorRulesToggles = controller.stateManager.getWorkspaceStateKey("localCursorRulesToggles")

	// cursor has two valid locations for rules files, so we need to check both and combine
	// synchronizeRuleToggles will drop whichever rules files are not in each given path, but combining the results will result in no data loss
	let localCursorRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.cursorRulesDir)
	const updatedLocalCursorToggles1 = await synchronizeRuleToggles(localCursorRulesFilePath, localCursorRulesToggles, ".mdc")

	localCursorRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.cursorRulesFile)
	const updatedLocalCursorToggles2 = await synchronizeRuleToggles(localCursorRulesFilePath, localCursorRulesToggles)

	const updatedLocalCursorToggles = combineRuleToggles(updatedLocalCursorToggles1, updatedLocalCursorToggles2)
	controller.stateManager.setWorkspaceState("localCursorRulesToggles", updatedLocalCursorToggles)

	// local agents toggles
	const localAgentsRulesToggles = controller.stateManager.getWorkspaceStateKey("localAgentsRulesToggles")
	const localAgentsRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.agentsRulesFile)
	const updatedLocalAgentsToggles = await synchronizeRuleToggles(localAgentsRulesFilePath, localAgentsRulesToggles)
	controller.stateManager.setWorkspaceState("localAgentsRulesToggles", updatedLocalAgentsToggles)

	return {
		windsurfLocalToggles: updatedLocalWindsurfToggles,
		cursorLocalToggles: updatedLocalCursorToggles,
		agentsLocalToggles: updatedLocalAgentsToggles,
	}
}

/**
 * Gather formatted windsurf rules
 */
export const getLocalWindsurfRules = async (cwd: string, toggles: ClineRulesToggles) => {
	const windsurfRulesFilePath = path.resolve(cwd, GlobalFileNames.windsurfRules)

	let windsurfRulesFileInstructions: string | undefined

	if (await fileExistsAtPath(windsurfRulesFilePath)) {
		if (!(await isDirectory(windsurfRulesFilePath))) {
			try {
				if (windsurfRulesFilePath in toggles && toggles[windsurfRulesFilePath] !== false) {
					const ruleFileContent = (await fs.readFile(windsurfRulesFilePath, "utf8")).trim()
					if (ruleFileContent) {
						windsurfRulesFileInstructions = formatResponse.windsurfRulesLocalFileInstructions(cwd, ruleFileContent)
					}
				}
			} catch {
				console.error(`Failed to read .windsurfrules file at ${windsurfRulesFilePath}`)
			}
		}
	}

	return windsurfRulesFileInstructions
}

/**
 * Gather formatted cursor rules, which can come from two sources
 */
export const getLocalCursorRules = async (cwd: string, toggles: ClineRulesToggles) => {
	// we first check for the .cursorrules file
	const cursorRulesFilePath = path.resolve(cwd, GlobalFileNames.cursorRulesFile)
	let cursorRulesFileInstructions: string | undefined

	if (await fileExistsAtPath(cursorRulesFilePath)) {
		if (!(await isDirectory(cursorRulesFilePath))) {
			try {
				if (cursorRulesFilePath in toggles && toggles[cursorRulesFilePath] !== false) {
					const ruleFileContent = (await fs.readFile(cursorRulesFilePath, "utf8")).trim()
					if (ruleFileContent) {
						cursorRulesFileInstructions = formatResponse.cursorRulesLocalFileInstructions(cwd, ruleFileContent)
					}
				}
			} catch {
				console.error(`Failed to read .cursorrules file at ${cursorRulesFilePath}`)
			}
		}
	}

	// we then check for the .cursor/rules dir
	const cursorRulesDirPath = path.resolve(cwd, GlobalFileNames.cursorRulesDir)
	let cursorRulesDirInstructions: string | undefined

	if (await fileExistsAtPath(cursorRulesDirPath)) {
		if (await isDirectory(cursorRulesDirPath)) {
			try {
				const rulesFilePaths = await readDirectoryRecursive(cursorRulesDirPath, ".mdc")
				const rulesFilesTotalContent = await getRuleFilesTotalContent(rulesFilePaths, cwd, toggles)
				if (rulesFilesTotalContent) {
					cursorRulesDirInstructions = formatResponse.cursorRulesLocalDirectoryInstructions(cwd, rulesFilesTotalContent)
				}
			} catch {
				console.error(`Failed to read .cursor/rules directory at ${cursorRulesDirPath}`)
			}
		}
	}

	return [cursorRulesFileInstructions, cursorRulesDirInstructions]
}

/**
 * Helper function to find all agents.md files recursively (case-insensitive)
 * Only searches if a top-level agents.md file exists
 */
async function findAgentsMdFiles(cwd: string): Promise<string[]> {
	try {
		// First check if top-level agents.md exists
		const topLevelAgentsPath = path.resolve(cwd, GlobalFileNames.agentsRulesFile)
		const topLevelExists = await fileExistsAtPath(topLevelAgentsPath)

		// Only search recursively if top-level agents.md exists
		if (!topLevelExists) {
			return []
		}

		// Search recursively for all agents.md files
		const [allFiles] = await listFiles(cwd, true, 500)
		return allFiles.filter((filePath) => {
			const basename = path.basename(filePath).toLowerCase()
			return basename === GlobalFileNames.agentsRulesFile.toLowerCase()
		})
	} catch (error) {
		console.error(`Failed to find agents.md files in ${cwd}:`, error)
		return []
	}
}

/**
 * Gather formatted agents rules - searches recursively and combines all agents.md files
 */
export const getLocalAgentsRules = async (cwd: string, toggles: ClineRulesToggles) => {
	const agentsRulesFilePath = path.resolve(cwd, GlobalFileNames.agentsRulesFile)

	// Check if the top-level agents.md file is enabled
	if (agentsRulesFilePath in toggles && toggles[agentsRulesFilePath] === false) {
		return undefined
	}

	try {
		const agentsMdFiles = await findAgentsMdFiles(cwd)

		if (agentsMdFiles.length === 0) {
			return undefined
		}

		// Read and combine all agents.md files
		const combinedContent = await Promise.all(
			agentsMdFiles.map(async (filePath) => {
				try {
					const fullPath = path.resolve(cwd, filePath)
					const content = (await fs.readFile(fullPath, "utf8")).trim()
					if (content) {
						const relativePath = path.relative(cwd, fullPath)
						return `## ${relativePath}\n\n${content}`
					}
					return null
				} catch (error) {
					console.error(`Failed to read agents.md file at ${filePath}:`, error)
					return null
				}
			}),
		).then((contents) => contents.filter(Boolean).join("\n\n"))

		if (combinedContent) {
			return formatResponse.agentsRulesLocalFileInstructions(cwd, combinedContent)
		}
	} catch (error) {
		console.error("Failed to read agents.md files:", error)
	}

	return undefined
}
