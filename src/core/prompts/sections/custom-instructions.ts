import fs from "fs/promises"
import path from "path"
import * as os from "os"
import { Dirent } from "fs"

import { isLanguage } from "@roo-code/types"

import type { SystemPromptSettings } from "../types"

import { LANGUAGES } from "../../../shared/language"
import { getRooDirectoriesForCwd, getGlobalRooDirectory } from "../../../services/roo-config"

/**
 * Safely read a file and return its trimmed content
 */
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

/**
 * Check if a directory exists
 */
async function directoryExists(dirPath: string): Promise<boolean> {
	try {
		const stats = await fs.stat(dirPath)
		return stats.isDirectory()
	} catch (err) {
		return false
	}
}

const MAX_DEPTH = 5

/**
 * Recursively resolve directory entries and collect file paths
 */
async function resolveDirectoryEntry(
	entry: Dirent,
	dirPath: string,
	fileInfo: Array<{ originalPath: string; resolvedPath: string }>,
	depth: number,
): Promise<void> {
	// Avoid cyclic symlinks
	if (depth > MAX_DEPTH) {
		return
	}

	const fullPath = path.resolve(entry.parentPath || dirPath, entry.name)
	if (entry.isFile()) {
		// Regular file - both original and resolved paths are the same
		fileInfo.push({ originalPath: fullPath, resolvedPath: fullPath })
	} else if (entry.isSymbolicLink()) {
		// Await the resolution of the symbolic link
		await resolveSymLink(fullPath, fileInfo, depth + 1)
	}
}

/**
 * Recursively resolve a symbolic link and collect file paths
 */
async function resolveSymLink(
	symlinkPath: string,
	fileInfo: Array<{ originalPath: string; resolvedPath: string }>,
	depth: number,
): Promise<void> {
	// Avoid cyclic symlinks
	if (depth > MAX_DEPTH) {
		return
	}
	try {
		// Get the symlink target
		const linkTarget = await fs.readlink(symlinkPath)
		// Resolve the target path (relative to the symlink location)
		const resolvedTarget = path.resolve(path.dirname(symlinkPath), linkTarget)

		// Check if the target is a file
		const stats = await fs.stat(resolvedTarget)
		if (stats.isFile()) {
			// For symlinks to files, store the symlink path as original and target as resolved
			fileInfo.push({ originalPath: symlinkPath, resolvedPath: resolvedTarget })
		} else if (stats.isDirectory()) {
			const anotherEntries = await fs.readdir(resolvedTarget, { withFileTypes: true, recursive: true })
			// Collect promises for recursive calls within the directory
			const directoryPromises: Promise<void>[] = []
			for (const anotherEntry of anotherEntries) {
				directoryPromises.push(resolveDirectoryEntry(anotherEntry, resolvedTarget, fileInfo, depth + 1))
			}
			// Wait for all entries in the resolved directory to be processed
			await Promise.all(directoryPromises)
		} else if (stats.isSymbolicLink()) {
			// Handle nested symlinks by awaiting the recursive call
			await resolveSymLink(resolvedTarget, fileInfo, depth + 1)
		}
	} catch (err) {
		// Skip invalid symlinks
	}
}

/**
 * Read all text files from a directory in alphabetical order
 */
async function readTextFilesFromDirectory(dirPath: string): Promise<Array<{ filename: string; content: string }>> {
	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true, recursive: true })

		// Process all entries - regular files and symlinks that might point to files
		// Store both original path (for sorting) and resolved path (for reading)
		const fileInfo: Array<{ originalPath: string; resolvedPath: string }> = []
		// Collect promises for the initial resolution calls
		const initialPromises: Promise<void>[] = []

		for (const entry of entries) {
			initialPromises.push(resolveDirectoryEntry(entry, dirPath, fileInfo, 0))
		}

		// Wait for all asynchronous operations (including recursive ones) to complete
		await Promise.all(initialPromises)

		const fileContents = await Promise.all(
			fileInfo.map(async ({ originalPath, resolvedPath }) => {
				try {
					// Check if it's a file (not a directory)
					const stats = await fs.stat(resolvedPath)
					if (stats.isFile()) {
						// Filter out cache files and system files that shouldn't be in rules
						if (!shouldIncludeRuleFile(resolvedPath)) {
							return null
						}
						const content = await safeReadFile(resolvedPath)
						// Use resolvedPath for display to maintain existing behavior
						return { filename: resolvedPath, content, sortKey: originalPath }
					}
					return null
				} catch (err) {
					return null
				}
			}),
		)

		// Filter out null values (directories, failed reads, or excluded files)
		const filteredFiles = fileContents.filter(
			(item): item is { filename: string; content: string; sortKey: string } => item !== null,
		)

		// Sort files alphabetically by the original filename (case-insensitive) to ensure consistent order
		// For symlinks, this will use the symlink name, not the target name
		return filteredFiles
			.sort((a, b) => {
				const filenameA = path.basename(a.sortKey).toLowerCase()
				const filenameB = path.basename(b.sortKey).toLowerCase()
				return filenameA.localeCompare(filenameB)
			})
			.map(({ filename, content }) => ({ filename, content }))
	} catch (err) {
		return []
	}
}

/**
 * Format content from multiple files with filenames as headers
 */
function formatDirectoryContent(dirPath: string, files: Array<{ filename: string; content: string }>): string {
	if (files.length === 0) return ""

	return files
		.map((file) => {
			return `# Rules from ${file.filename}:\n${file.content}`
		})
		.join("\n\n")
}

/**
 * Load rule files from global and project-local directories
 * Global rules are loaded first, then project-local rules which can override global ones
 */
export async function loadRuleFiles(cwd: string): Promise<string> {
	const rules: string[] = []
	const rooDirectories = getRooDirectoriesForCwd(cwd)

	// Check for .roo/rules/ directories in order (global first, then project-local)
	for (const rooDir of rooDirectories) {
		const rulesDir = path.join(rooDir, "rules")
		if (await directoryExists(rulesDir)) {
			const files = await readTextFilesFromDirectory(rulesDir)
			if (files.length > 0) {
				const content = formatDirectoryContent(rulesDir, files)
				rules.push(content)
			}
		}
	}

	// If we found rules in .roo/rules/ directories, return them
	if (rules.length > 0) {
		return "\n" + rules.join("\n\n")
	}

	// Fall back to existing behavior for legacy .roorules/.clinerules files
	const ruleFiles = [".roorules", ".clinerules"]

	for (const file of ruleFiles) {
		const content = await safeReadFile(path.join(cwd, file))
		if (content) {
			return `\n# Rules from ${file}:\n${content}\n`
		}
	}

	return ""
}

/**
 * Load AGENTS.md or AGENT.md file from the project root if it exists
 * Checks for both AGENTS.md (standard) and AGENT.md (alternative) for compatibility
 */
async function loadAgentRulesFile(cwd: string): Promise<string> {
	// Try both filenames - AGENTS.md (standard) first, then AGENT.md (alternative)
	const filenames = ["AGENTS.md", "AGENT.md"]

	for (const filename of filenames) {
		try {
			const agentPath = path.join(cwd, filename)
			let resolvedPath = agentPath

			// Check if file exists and handle symlinks
			try {
				const stats = await fs.lstat(agentPath)
				if (stats.isSymbolicLink()) {
					// Create a temporary fileInfo array to use with resolveSymLink
					const fileInfo: Array<{ originalPath: string; resolvedPath: string }> = []

					// Use the existing resolveSymLink function to handle symlink resolution
					await resolveSymLink(agentPath, fileInfo, 0)

					// Extract the resolved path from fileInfo
					if (fileInfo.length > 0) {
						resolvedPath = fileInfo[0].resolvedPath
					}
				}
			} catch (err) {
				// If lstat fails (file doesn't exist), try next filename
				continue
			}

			// Read the content from the resolved path
			const content = await safeReadFile(resolvedPath)
			if (content) {
				return `# Agent Rules Standard (${filename}):\n${content}`
			}
		} catch (err) {
			// Silently ignore errors - agent rules files are optional
		}
	}
	return ""
}

export async function addCustomInstructions(
	modeCustomInstructions: string,
	globalCustomInstructions: string,
	cwd: string,
	mode: string,
	options: {
		language?: string
		rooIgnoreInstructions?: string
		settings?: SystemPromptSettings
	} = {},
): Promise<string> {
	const sections = []

	// Load mode-specific rules if mode is provided
	let modeRuleContent = ""
	let usedRuleFile = ""

	if (mode) {
		const modeRules: string[] = []
		const rooDirectories = getRooDirectoriesForCwd(cwd)

		// Check for .roo/rules-${mode}/ directories in order (global first, then project-local)
		for (const rooDir of rooDirectories) {
			const modeRulesDir = path.join(rooDir, `rules-${mode}`)
			if (await directoryExists(modeRulesDir)) {
				const files = await readTextFilesFromDirectory(modeRulesDir)
				if (files.length > 0) {
					const content = formatDirectoryContent(modeRulesDir, files)
					modeRules.push(content)
				}
			}
		}

		// If we found mode-specific rules in .roo/rules-${mode}/ directories, use them
		if (modeRules.length > 0) {
			modeRuleContent = "\n" + modeRules.join("\n\n")
			usedRuleFile = `rules-${mode} directories`
		} else {
			// Fall back to existing behavior for legacy files
			const rooModeRuleFile = `.roorules-${mode}`
			modeRuleContent = await safeReadFile(path.join(cwd, rooModeRuleFile))
			if (modeRuleContent) {
				usedRuleFile = rooModeRuleFile
			} else {
				const clineModeRuleFile = `.clinerules-${mode}`
				modeRuleContent = await safeReadFile(path.join(cwd, clineModeRuleFile))
				if (modeRuleContent) {
					usedRuleFile = clineModeRuleFile
				}
			}
		}
	}

	// Add language preference if provided
	if (options.language) {
		const languageName = isLanguage(options.language) ? LANGUAGES[options.language] : options.language
		sections.push(
			`Language Preference:\nYou should always speak and think in the "${languageName}" (${options.language}) language unless the user gives you instructions below to do otherwise.`,
		)
	}

	// Add global instructions first
	if (typeof globalCustomInstructions === "string" && globalCustomInstructions.trim()) {
		sections.push(`Global Instructions:\n${globalCustomInstructions.trim()}`)
	}

	// Add mode-specific instructions after
	if (typeof modeCustomInstructions === "string" && modeCustomInstructions.trim()) {
		sections.push(`Mode-specific Instructions:\n${modeCustomInstructions.trim()}`)
	}

	// Add rules - include both mode-specific and generic rules if they exist
	const rules = []

	// Add mode-specific rules first if they exist
	if (modeRuleContent && modeRuleContent.trim()) {
		if (usedRuleFile.includes(path.join(".roo", `rules-${mode}`))) {
			rules.push(modeRuleContent.trim())
		} else {
			rules.push(`# Rules from ${usedRuleFile}:\n${modeRuleContent}`)
		}
	}

	if (options.rooIgnoreInstructions) {
		rules.push(options.rooIgnoreInstructions)
	}

	// Add AGENTS.md content if enabled (default: true)
	if (options.settings?.useAgentRules !== false) {
		const agentRulesContent = await loadAgentRulesFile(cwd)
		if (agentRulesContent && agentRulesContent.trim()) {
			rules.push(agentRulesContent.trim())
		}
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

/**
 * Check if a file should be included in rule compilation.
 * Excludes cache files and system files that shouldn't be processed as rules.
 */
function shouldIncludeRuleFile(filename: string): boolean {
	const basename = path.basename(filename)

	const cachePatterns = [
		"*.DS_Store",
		"*.bak",
		"*.cache",
		"*.crdownload",
		"*.db",
		"*.dmp",
		"*.dump",
		"*.eslintcache",
		"*.lock",
		"*.log",
		"*.old",
		"*.part",
		"*.partial",
		"*.pyc",
		"*.pyo",
		"*.stackdump",
		"*.swo",
		"*.swp",
		"*.temp",
		"*.tmp",
		"Thumbs.db",
	]

	return !cachePatterns.some((pattern) => {
		if (pattern.startsWith("*.")) {
			const extension = pattern.slice(1)
			return basename.endsWith(extension)
		} else {
			return basename === pattern
		}
	})
}
