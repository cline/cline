import fs from "fs/promises"
import * as path from "path"
import matter from "gray-matter"
import { getGlobalRooDirectory, getProjectRooDirectoryForCwd } from "../roo-config"
import { getBuiltInCommands, getBuiltInCommand } from "./built-in-commands"

export interface Command {
	name: string
	content: string
	source: "global" | "project" | "built-in"
	filePath: string
	description?: string
	argumentHint?: string
}

/**
 * Get all available commands from built-in, global, and project directories
 * Priority order: project > global > built-in (later sources override earlier ones)
 */
export async function getCommands(cwd: string): Promise<Command[]> {
	const commands = new Map<string, Command>()

	// Add built-in commands first (lowest priority)
	const builtInCommands = await getBuiltInCommands()
	for (const command of builtInCommands) {
		commands.set(command.name, command)
	}

	// Scan global commands (override built-in)
	const globalDir = path.join(getGlobalRooDirectory(), "commands")
	await scanCommandDirectory(globalDir, "global", commands)

	// Scan project commands (highest priority - override both global and built-in)
	const projectDir = path.join(getProjectRooDirectoryForCwd(cwd), "commands")
	await scanCommandDirectory(projectDir, "project", commands)

	return Array.from(commands.values())
}

/**
 * Get a specific command by name (optimized to avoid scanning all commands)
 * Priority order: project > global > built-in
 */
export async function getCommand(cwd: string, name: string): Promise<Command | undefined> {
	// Try to find the command directly without scanning all commands
	const projectDir = path.join(getProjectRooDirectoryForCwd(cwd), "commands")
	const globalDir = path.join(getGlobalRooDirectory(), "commands")

	// Check project directory first (highest priority)
	const projectCommand = await tryLoadCommand(projectDir, name, "project")
	if (projectCommand) {
		return projectCommand
	}

	// Check global directory if not found in project
	const globalCommand = await tryLoadCommand(globalDir, name, "global")
	if (globalCommand) {
		return globalCommand
	}

	// Check built-in commands if not found in project or global (lowest priority)
	return await getBuiltInCommand(name)
}

/**
 * Try to load a specific command from a directory
 */
async function tryLoadCommand(
	dirPath: string,
	name: string,
	source: "global" | "project",
): Promise<Command | undefined> {
	try {
		const stats = await fs.stat(dirPath)
		if (!stats.isDirectory()) {
			return undefined
		}

		// Try to find the command file directly
		const commandFileName = `${name}.md`
		const filePath = path.join(dirPath, commandFileName)

		try {
			const content = await fs.readFile(filePath, "utf-8")

			let parsed
			let description: string | undefined
			let argumentHint: string | undefined
			let commandContent: string

			try {
				// Try to parse frontmatter with gray-matter
				parsed = matter(content)
				description =
					typeof parsed.data.description === "string" && parsed.data.description.trim()
						? parsed.data.description.trim()
						: undefined
				argumentHint =
					typeof parsed.data["argument-hint"] === "string" && parsed.data["argument-hint"].trim()
						? parsed.data["argument-hint"].trim()
						: undefined
				commandContent = parsed.content.trim()
			} catch (frontmatterError) {
				// If frontmatter parsing fails, treat the entire content as command content
				description = undefined
				argumentHint = undefined
				commandContent = content.trim()
			}

			return {
				name,
				content: commandContent,
				source,
				filePath,
				description,
				argumentHint,
			}
		} catch (error) {
			// File doesn't exist or can't be read
			return undefined
		}
	} catch (error) {
		// Directory doesn't exist or can't be read
		return undefined
	}
}

/**
 * Get command names for autocomplete
 */
export async function getCommandNames(cwd: string): Promise<string[]> {
	const commands = await getCommands(cwd)
	return commands.map((cmd) => cmd.name)
}

/**
 * Scan a specific command directory
 */
async function scanCommandDirectory(
	dirPath: string,
	source: "global" | "project",
	commands: Map<string, Command>,
): Promise<void> {
	try {
		const stats = await fs.stat(dirPath)
		if (!stats.isDirectory()) {
			return
		}

		const entries = await fs.readdir(dirPath, { withFileTypes: true })

		for (const entry of entries) {
			if (entry.isFile() && isMarkdownFile(entry.name)) {
				const filePath = path.join(dirPath, entry.name)
				const commandName = getCommandNameFromFile(entry.name)

				try {
					const content = await fs.readFile(filePath, "utf-8")

					let parsed
					let description: string | undefined
					let argumentHint: string | undefined
					let commandContent: string

					try {
						// Try to parse frontmatter with gray-matter
						parsed = matter(content)
						description =
							typeof parsed.data.description === "string" && parsed.data.description.trim()
								? parsed.data.description.trim()
								: undefined
						argumentHint =
							typeof parsed.data["argument-hint"] === "string" && parsed.data["argument-hint"].trim()
								? parsed.data["argument-hint"].trim()
								: undefined
						commandContent = parsed.content.trim()
					} catch (frontmatterError) {
						// If frontmatter parsing fails, treat the entire content as command content
						description = undefined
						argumentHint = undefined
						commandContent = content.trim()
					}

					// Project commands override global ones
					if (source === "project" || !commands.has(commandName)) {
						commands.set(commandName, {
							name: commandName,
							content: commandContent,
							source,
							filePath,
							description,
							argumentHint,
						})
					}
				} catch (error) {
					console.warn(`Failed to read command file ${filePath}:`, error)
				}
			}
		}
	} catch (error) {
		// Directory doesn't exist or can't be read - this is fine
	}
}

/**
 * Extract command name from filename (strip .md extension only)
 */
export function getCommandNameFromFile(filename: string): string {
	if (filename.toLowerCase().endsWith(".md")) {
		return filename.slice(0, -3)
	}
	return filename
}

/**
 * Check if a file is a markdown file
 */
export function isMarkdownFile(filename: string): boolean {
	return filename.toLowerCase().endsWith(".md")
}
