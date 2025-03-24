import fs from "fs/promises"
import path from "path"
import * as vscode from "vscode"
import { LANGUAGES } from "../../../shared/language"

async function safeReadFile(filePath: string): Promise<string> {
	try {
		const content = await fs.readFile(filePath, "utf-8")
		return content.trim()
	} catch (err) {
		const errorCode = (err as NodeJS.ErrnoException).code
		if (!errorCode || !["ENOENT", "EISDIR"].includes(errorCode)) {
			throw err
		}
		return ""
	}
}

async function findRuleInDirectory(dir: string, ruleFile: string): Promise<string> {
	const filePath = path.join(dir, ruleFile)
	const content = await safeReadFile(filePath)

	if (content) {
		return content
	}

	// Check if we've reached the root directory
	const parentDir = path.dirname(dir)
	if (parentDir === dir) {
		return ""
	}

	// Recursively check parent directory
	return findRuleInDirectory(parentDir, ruleFile)
}

export async function loadRuleFiles(cwd: string): Promise<string> {
	const ruleFiles = [".clinerules", ".cursorrules", ".windsurfrules"]
	let combinedRules = ""

	for (const file of ruleFiles) {
		const content = await findRuleInDirectory(cwd, file)
		if (content) {
			combinedRules += `\n# Rules from ${file}:\n${content}\n`
		}
	}

	return combinedRules
}

async function findCustomInstructionsFile(dir: string, filePattern: string): Promise<string> {
	// First try to find as a direct file
	const content = await findRuleInDirectory(dir, filePattern)
	if (content) {
		return content
	}

	// If not found as a file, check if it's raw content
	return filePattern.trim()
}

export async function addCustomInstructions(
	modeCustomInstructions: string,
	globalCustomInstructions: string,
	cwd: string,
	mode: string,
	options: { language?: string; rooIgnoreInstructions?: string } = {},
): Promise<string> {
	const sections = []

	// Load mode-specific rules if mode is provided
	let modeRuleContent = ""
	if (mode) {
		const modeRuleFile = `.clinerules-${mode}`
		modeRuleContent = await safeReadFile(path.join(cwd, modeRuleFile))
	}

	// Add language preference if provided
	if (options.language) {
		const languageName = LANGUAGES[options.language] || options.language
		sections.push(
			`Language Preference:\nYou should always speak and think in the "${languageName}" (${options.language}) language unless the user gives you instructions below to do otherwise.`,
		)
	}

	// Add global instructions first - try to find as file or use raw content
	const globalContent = await findCustomInstructionsFile(cwd, globalCustomInstructions)
	if (globalContent) {
		sections.push(`Global Instructions:\n${globalContent}`)
	}

	// Add mode-specific instructions - try to find as file or use raw content
	const modeContent = await findCustomInstructionsFile(cwd, modeCustomInstructions)
	if (modeContent) {
		sections.push(`Mode-specific Instructions:\n${modeContent}`)
	}

	// Add rules - include both mode-specific and generic rules if they exist
	const rules = []

	// Add mode-specific rules first if they exist
	if (modeRuleContent && modeRuleContent.trim()) {
		const modeRuleFile = `.clinerules-${mode}`
		rules.push(`# Rules from ${modeRuleFile}:\n${modeRuleContent}`)
	}

	if (options.rooIgnoreInstructions) {
		rules.push(options.rooIgnoreInstructions)
	}

	// Add generic rules
	const genericRuleContent = await loadRuleFiles(cwd)
	if (genericRuleContent && genericRuleContent.trim()) {
		rules.push(genericRuleContent.trim())
	}

	if (rules.length > 0) {
		sections.push(`Rules:\n\n${rules.join("\n\n")}`)
	}

	const joinedSections = sections.join("\n\n")

	return joinedSections
		? `
====

USER'S CUSTOM INSTRUCTIONS

The following additional instructions are provided by the user, and should be followed to the best of your ability without interfering with the TOOL USE guidelines.

${joinedSections}`
		: ""
}
