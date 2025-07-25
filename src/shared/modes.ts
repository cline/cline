import * as vscode from "vscode"

import {
	type GroupOptions,
	type GroupEntry,
	type ModeConfig,
	type CustomModePrompts,
	type ExperimentId,
	type ToolGroup,
	type PromptComponent,
	DEFAULT_MODES,
} from "@roo-code/types"

import { addCustomInstructions } from "../core/prompts/sections/custom-instructions"

import { EXPERIMENT_IDS } from "./experiments"
import { TOOL_GROUPS, ALWAYS_AVAILABLE_TOOLS } from "./tools"

export type Mode = string

// Helper to extract group name regardless of format
export function getGroupName(group: GroupEntry): ToolGroup {
	if (typeof group === "string") {
		return group
	}

	return group[0]
}

// Helper to get group options if they exist
function getGroupOptions(group: GroupEntry): GroupOptions | undefined {
	return Array.isArray(group) ? group[1] : undefined
}

// Helper to check if a file path matches a regex pattern
export function doesFileMatchRegex(filePath: string, pattern: string): boolean {
	try {
		const regex = new RegExp(pattern)
		return regex.test(filePath)
	} catch (error) {
		console.error(`Invalid regex pattern: ${pattern}`, error)
		return false
	}
}

// Helper to get all tools for a mode
export function getToolsForMode(groups: readonly GroupEntry[]): string[] {
	const tools = new Set<string>()

	// Add tools from each group
	groups.forEach((group) => {
		const groupName = getGroupName(group)
		const groupConfig = TOOL_GROUPS[groupName]
		groupConfig.tools.forEach((tool: string) => tools.add(tool))
	})

	// Always add required tools
	ALWAYS_AVAILABLE_TOOLS.forEach((tool) => tools.add(tool))

	return Array.from(tools)
}

// Main modes configuration as an ordered array
export const modes = DEFAULT_MODES

// Export the default mode slug
export const defaultModeSlug = modes[0].slug

// Helper functions
export function getModeBySlug(slug: string, customModes?: ModeConfig[]): ModeConfig | undefined {
	// Check custom modes first
	const customMode = customModes?.find((mode) => mode.slug === slug)
	if (customMode) {
		return customMode
	}
	// Then check built-in modes
	return modes.find((mode) => mode.slug === slug)
}

export function getModeConfig(slug: string, customModes?: ModeConfig[]): ModeConfig {
	const mode = getModeBySlug(slug, customModes)
	if (!mode) {
		throw new Error(`No mode found for slug: ${slug}`)
	}
	return mode
}

// Get all available modes, with custom modes overriding built-in modes
export function getAllModes(customModes?: ModeConfig[]): ModeConfig[] {
	if (!customModes?.length) {
		return [...modes]
	}

	// Start with built-in modes
	const allModes = [...modes]

	// Process custom modes
	customModes.forEach((customMode) => {
		const index = allModes.findIndex((mode) => mode.slug === customMode.slug)
		if (index !== -1) {
			// Override existing mode
			allModes[index] = customMode
		} else {
			// Add new mode
			allModes.push(customMode)
		}
	})

	return allModes
}

// Check if a mode is custom or an override
export function isCustomMode(slug: string, customModes?: ModeConfig[]): boolean {
	return !!customModes?.some((mode) => mode.slug === slug)
}

/**
 * Find a mode by its slug, don't fall back to built-in modes
 */
export function findModeBySlug(slug: string, modes: readonly ModeConfig[] | undefined): ModeConfig | undefined {
	return modes?.find((mode) => mode.slug === slug)
}

/**
 * Get the mode selection based on the provided mode slug, prompt component, and custom modes.
 * If a custom mode is found, it takes precedence over the built-in modes.
 * If no custom mode is found, the built-in mode is used with partial merging from promptComponent.
 * If neither is found, the default mode is used.
 */
export function getModeSelection(mode: string, promptComponent?: PromptComponent, customModes?: ModeConfig[]) {
	const customMode = findModeBySlug(mode, customModes)
	const builtInMode = findModeBySlug(mode, modes)

	// If we have a custom mode, use it entirely
	if (customMode) {
		return {
			roleDefinition: customMode.roleDefinition || "",
			baseInstructions: customMode.customInstructions || "",
			description: customMode.description || "",
		}
	}

	// Otherwise, use built-in mode as base and merge with promptComponent
	const baseMode = builtInMode || modes[0] // fallback to default mode

	return {
		roleDefinition: promptComponent?.roleDefinition || baseMode.roleDefinition || "",
		baseInstructions: promptComponent?.customInstructions || baseMode.customInstructions || "",
		description: baseMode.description || "",
	}
}

// Edit operation parameters that indicate an actual edit operation
const EDIT_OPERATION_PARAMS = ["diff", "content", "operations", "search", "replace", "args", "line"] as const

// Custom error class for file restrictions
export class FileRestrictionError extends Error {
	constructor(mode: string, pattern: string, description: string | undefined, filePath: string, tool?: string) {
		const toolInfo = tool ? `Tool '${tool}' in mode '${mode}'` : `This mode (${mode})`
		super(
			`${toolInfo} can only edit files matching pattern: ${pattern}${description ? ` (${description})` : ""}. Got: ${filePath}`,
		)
		this.name = "FileRestrictionError"
	}
}

export function isToolAllowedForMode(
	tool: string,
	modeSlug: string,
	customModes: ModeConfig[],
	toolRequirements?: Record<string, boolean>,
	toolParams?: Record<string, any>, // All tool parameters
	experiments?: Record<string, boolean>,
): boolean {
	// Always allow these tools
	if (ALWAYS_AVAILABLE_TOOLS.includes(tool as any)) {
		return true
	}
	if (experiments && Object.values(EXPERIMENT_IDS).includes(tool as ExperimentId)) {
		if (!experiments[tool]) {
			return false
		}
	}

	// Check tool requirements if any exist
	if (toolRequirements && typeof toolRequirements === "object") {
		if (tool in toolRequirements && !toolRequirements[tool]) {
			return false
		}
	} else if (toolRequirements === false) {
		// If toolRequirements is a boolean false, all tools are disabled
		return false
	}

	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		return false
	}

	// Check if tool is in any of the mode's groups and respects any group options
	for (const group of mode.groups) {
		const groupName = getGroupName(group)
		const options = getGroupOptions(group)

		const groupConfig = TOOL_GROUPS[groupName]

		// If the tool isn't in this group's tools, continue to next group
		if (!groupConfig.tools.includes(tool)) {
			continue
		}

		// If there are no options, allow the tool
		if (!options) {
			return true
		}

		// For the edit group, check file regex if specified
		if (groupName === "edit" && options.fileRegex) {
			const filePath = toolParams?.path
			// Check if this is an actual edit operation (not just path-only for streaming)
			const isEditOperation = EDIT_OPERATION_PARAMS.some((param) => toolParams?.[param])

			// Handle single file path validation
			if (filePath && isEditOperation && !doesFileMatchRegex(filePath, options.fileRegex)) {
				throw new FileRestrictionError(mode.name, options.fileRegex, options.description, filePath, tool)
			}

			// Handle XML args parameter (used by MULTI_FILE_APPLY_DIFF experiment)
			if (toolParams?.args && typeof toolParams.args === "string") {
				// Extract file paths from XML args with improved validation
				try {
					const filePathMatches = toolParams.args.match(/<path>([^<]+)<\/path>/g)
					if (filePathMatches) {
						for (const match of filePathMatches) {
							// More robust path extraction with validation
							const pathMatch = match.match(/<path>([^<]+)<\/path>/)
							if (pathMatch && pathMatch[1]) {
								const extractedPath = pathMatch[1].trim()
								// Validate that the path is not empty and doesn't contain invalid characters
								if (extractedPath && !extractedPath.includes("<") && !extractedPath.includes(">")) {
									if (!doesFileMatchRegex(extractedPath, options.fileRegex)) {
										throw new FileRestrictionError(
											mode.name,
											options.fileRegex,
											options.description,
											extractedPath,
											tool,
										)
									}
								}
							}
						}
					}
				} catch (error) {
					// Re-throw FileRestrictionError as it's an expected validation error
					if (error instanceof FileRestrictionError) {
						throw error
					}
					// If XML parsing fails, log the error but don't block the operation
					console.warn(`Failed to parse XML args for file restriction validation: ${error}`)
				}
			}
		}

		return true
	}

	return false
}

// Create the mode-specific default prompts
export const defaultPrompts: Readonly<CustomModePrompts> = Object.freeze(
	Object.fromEntries(
		modes.map((mode) => [
			mode.slug,
			{
				roleDefinition: mode.roleDefinition,
				whenToUse: mode.whenToUse,
				customInstructions: mode.customInstructions,
				description: mode.description,
			},
		]),
	),
)

// Helper function to get all modes with their prompt overrides from extension state
export async function getAllModesWithPrompts(context: vscode.ExtensionContext): Promise<ModeConfig[]> {
	const customModes = (await context.globalState.get<ModeConfig[]>("customModes")) || []
	const customModePrompts = (await context.globalState.get<CustomModePrompts>("customModePrompts")) || {}

	const allModes = getAllModes(customModes)
	return allModes.map((mode) => ({
		...mode,
		roleDefinition: customModePrompts[mode.slug]?.roleDefinition ?? mode.roleDefinition,
		whenToUse: customModePrompts[mode.slug]?.whenToUse ?? mode.whenToUse,
		customInstructions: customModePrompts[mode.slug]?.customInstructions ?? mode.customInstructions,
		// description is not overridable via customModePrompts, so we keep the original
	}))
}

// Helper function to get complete mode details with all overrides
export async function getFullModeDetails(
	modeSlug: string,
	customModes?: ModeConfig[],
	customModePrompts?: CustomModePrompts,
	options?: {
		cwd?: string
		globalCustomInstructions?: string
		language?: string
	},
): Promise<ModeConfig> {
	// First get the base mode config from custom modes or built-in modes
	const baseMode = getModeBySlug(modeSlug, customModes) || modes.find((m) => m.slug === modeSlug) || modes[0]

	// Check for any prompt component overrides
	const promptComponent = customModePrompts?.[modeSlug]

	// Get the base custom instructions
	const baseCustomInstructions = promptComponent?.customInstructions || baseMode.customInstructions || ""
	const baseWhenToUse = promptComponent?.whenToUse || baseMode.whenToUse || ""
	const baseDescription = promptComponent?.description || baseMode.description || ""

	// If we have cwd, load and combine all custom instructions
	let fullCustomInstructions = baseCustomInstructions
	if (options?.cwd) {
		fullCustomInstructions = await addCustomInstructions(
			baseCustomInstructions,
			options.globalCustomInstructions || "",
			options.cwd,
			modeSlug,
			{ language: options.language },
		)
	}

	// Return mode with any overrides applied
	return {
		...baseMode,
		roleDefinition: promptComponent?.roleDefinition || baseMode.roleDefinition,
		whenToUse: baseWhenToUse,
		description: baseDescription,
		customInstructions: fullCustomInstructions,
	}
}

// Helper function to safely get role definition
export function getRoleDefinition(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.roleDefinition
}

// Helper function to safely get description
export function getDescription(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.description ?? ""
}

// Helper function to safely get whenToUse
export function getWhenToUse(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.whenToUse ?? ""
}

// Helper function to safely get custom instructions
export function getCustomInstructions(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.customInstructions ?? ""
}
