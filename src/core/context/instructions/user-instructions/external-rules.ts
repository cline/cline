import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
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
import { Controller } from "@/core/controller"

// Types for better code clarity
type RuleSource = {
	filePath: string
	extension?: string
}

type RuleConfig = {
	stateKey: "localWindsurfRulesToggles" | "localCursorRulesToggles" | "localAgentsRulesToggles"
	sources: RuleSource[]
}

/**
 * Check if a directory is a sensitive location (home directory or Desktop)
 * Returns true if the directory is safe to process rules from
 */
function isSafeDirectory(workingDirectory: string): boolean {
	const normalizedPath = path.resolve(workingDirectory)
	const homeDir = os.homedir()
	const desktopDir = path.join(homeDir, "Desktop")

	// Don't process rules from home directory or Desktop
	if (normalizedPath === homeDir || normalizedPath === desktopDir) {
		return false
	}

	return true
}

/**
 * Helper to synchronize a single rule source
 */
async function syncRuleSource(
	workingDirectory: string,
	source: RuleSource,
	currentToggles: ClineRulesToggles,
): Promise<ClineRulesToggles> {
	const fullPath = path.resolve(workingDirectory, source.filePath)
	return await synchronizeRuleToggles(fullPath, currentToggles, source.extension)
}

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
	// Safety check: Don't process rules from home directory or Desktop
	if (!isSafeDirectory(workingDirectory)) {
		// Return empty toggles for unsafe directories
		return {
			windsurfLocalToggles: {},
			cursorLocalToggles: {},
			agentsLocalToggles: {},
		}
	}

	const configs: Record<string, RuleConfig> = {
		windsurf: {
			stateKey: "localWindsurfRulesToggles",
			sources: [{ filePath: GlobalFileNames.windsurfRules }],
		},
		cursor: {
			stateKey: "localCursorRulesToggles",
			sources: [
				{ filePath: GlobalFileNames.cursorRulesDir, extension: ".mdc" },
				{ filePath: GlobalFileNames.cursorRulesFile },
			],
		},
		agents: {
			stateKey: "localAgentsRulesToggles",
			sources: [{ filePath: GlobalFileNames.agentsRulesFile }],
		},
	}

	// Process windsurf
	const windsurfConfig = configs.windsurf
	const windsurfToggles = controller.stateManager.getWorkspaceStateKey(windsurfConfig.stateKey)
	const windsurfLocalToggles = await syncRuleSource(workingDirectory, windsurfConfig.sources[0], windsurfToggles)
	controller.stateManager.setWorkspaceState(windsurfConfig.stateKey, windsurfLocalToggles)

	// Process cursor (combine results from both sources)
	const cursorConfig = configs.cursor
	const cursorToggles = controller.stateManager.getWorkspaceStateKey(cursorConfig.stateKey)
	const [cursorToggles1, cursorToggles2] = await Promise.all([
		syncRuleSource(workingDirectory, cursorConfig.sources[0], cursorToggles),
		syncRuleSource(workingDirectory, cursorConfig.sources[1], cursorToggles),
	])
	const cursorLocalToggles = combineRuleToggles(cursorToggles1, cursorToggles2)
	controller.stateManager.setWorkspaceState(cursorConfig.stateKey, cursorLocalToggles)

	// Process agents
	const agentsConfig = configs.agents
	const agentsToggles = controller.stateManager.getWorkspaceStateKey(agentsConfig.stateKey)
	const agentsLocalToggles = await syncRuleSource(workingDirectory, agentsConfig.sources[0], agentsToggles)
	controller.stateManager.setWorkspaceState(agentsConfig.stateKey, agentsLocalToggles)

	return {
		windsurfLocalToggles,
		cursorLocalToggles,
		agentsLocalToggles,
	}
}

/**
 * Helper to read a single rule file
 */
async function readRuleFile(filePath: string, toggles: ClineRulesToggles): Promise<string | undefined> {
	// Check if file exists and is enabled
	if (!(await fileExistsAtPath(filePath))) {
		return undefined
	}
	if (await isDirectory(filePath)) {
		return undefined
	}
	if (filePath in toggles && toggles[filePath] === false) {
		return undefined
	}

	try {
		const content = (await fs.readFile(filePath, "utf8")).trim()
		return content || undefined
	} catch (error) {
		console.error(`Failed to read rule file at ${filePath}:`, error)
		return undefined
	}
}

/**
 * Gather formatted windsurf rules
 */
export const getLocalWindsurfRules = async (cwd: string, toggles: ClineRulesToggles) => {
	// Safety check: Don't process rules from home directory or Desktop
	if (!isSafeDirectory(cwd)) {
		return undefined
	}

	const filePath = path.resolve(cwd, GlobalFileNames.windsurfRules)
	const content = await readRuleFile(filePath, toggles)

	return content ? formatResponse.windsurfRulesLocalFileInstructions(cwd, content) : undefined
}

/**
 * Gather formatted cursor rules, which can come from two sources
 */
export const getLocalCursorRules = async (cwd: string, toggles: ClineRulesToggles) => {
	// Safety check: Don't process rules from home directory or Desktop
	if (!isSafeDirectory(cwd)) {
		return []
	}

	const results: (string | undefined)[] = []

	// Check .cursorrules file
	const cursorRulesFilePath = path.resolve(cwd, GlobalFileNames.cursorRulesFile)
	const fileContent = await readRuleFile(cursorRulesFilePath, toggles)
	if (fileContent) {
		results.push(formatResponse.cursorRulesLocalFileInstructions(cwd, fileContent))
	}

	// Check .cursor/rules directory
	const cursorRulesDirPath = path.resolve(cwd, GlobalFileNames.cursorRulesDir)
	if ((await fileExistsAtPath(cursorRulesDirPath)) && (await isDirectory(cursorRulesDirPath))) {
		try {
			const rulesFilePaths = await readDirectoryRecursive(cursorRulesDirPath, ".mdc")
			const rulesFilesTotalContent = await getRuleFilesTotalContent(rulesFilePaths, cwd, toggles)
			if (rulesFilesTotalContent) {
				results.push(formatResponse.cursorRulesLocalDirectoryInstructions(cwd, rulesFilesTotalContent))
			}
		} catch (error) {
			console.error(`Failed to read .cursor/rules directory at ${cursorRulesDirPath}:`, error)
		}
	}

	return results
}

/**
 * Helper function to find all agents.md files recursively (case-insensitive)
 * Only searches if a top-level agents.md file exists
 */
async function findAgentsMdFiles(cwd: string): Promise<string[]> {
	// First check if top-level agents.md exists
	const topLevelAgentsPath = path.resolve(cwd, GlobalFileNames.agentsRulesFile)
	if (!(await fileExistsAtPath(topLevelAgentsPath))) {
		return []
	}

	try {
		// Search recursively for all agents.md files
		const [allFiles] = await listFiles(cwd, true, 500)
		const agentsFileName = GlobalFileNames.agentsRulesFile.toLowerCase()

		return allFiles.filter((filePath) => path.basename(filePath).toLowerCase() === agentsFileName)
	} catch (error) {
		console.error(`Failed to find agents.md files in ${cwd}:`, error)
		return []
	}
}

/**
 * Gather formatted agents rules - searches recursively and combines all agents.md files
 */
export const getLocalAgentsRules = async (cwd: string, toggles: ClineRulesToggles) => {
	// Safety check: Don't process rules from home directory or Desktop
	if (!isSafeDirectory(cwd)) {
		return undefined
	}

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

		// Read and combine all agents.md files in parallel
		const contentPromises = agentsMdFiles.map(async (filePath) => {
			try {
				const fullPath = path.resolve(cwd, filePath)
				const content = (await fs.readFile(fullPath, "utf8")).trim()
				if (!content) {
					return null
				}

				const relativePath = path.relative(cwd, fullPath)
				return `## ${relativePath}\n\n${content}`
			} catch (error) {
				console.error(`Failed to read agents.md file at ${filePath}:`, error)
				return null
			}
		})

		const contents = await Promise.all(contentPromises)
		const combinedContent = contents.filter(Boolean).join("\n\n")

		return combinedContent ? formatResponse.agentsRulesLocalFileInstructions(cwd, combinedContent) : undefined
	} catch (error) {
		console.error("Failed to read agents.md files:", error)
		return undefined
	}
}
