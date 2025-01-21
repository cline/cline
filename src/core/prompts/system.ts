import {
	Mode,
	modes,
	CustomPrompts,
	PromptComponent,
	getRoleDefinition,
	defaultModeSlug,
	ModeConfig,
	getModeBySlug,
} from "../../shared/modes"
import { DiffStrategy } from "../diff/DiffStrategy"
import { McpHub } from "../../services/mcp/McpHub"
import { getToolDescriptionsForMode } from "./tools"
import * as vscode from "vscode"
import {
	getRulesSection,
	getSystemInfoSection,
	getObjectiveSection,
	getSharedToolUseSection,
	getMcpServersSection,
	getToolUseGuidelinesSection,
	getCapabilitiesSection,
	getModesSection,
	addCustomInstructions,
} from "./sections"
import fs from "fs/promises"
import path from "path"

async function generatePrompt(
	context: vscode.ExtensionContext,
	cwd: string,
	supportsComputerUse: boolean,
	mode: Mode,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	browserViewportSize?: string,
	promptComponent?: PromptComponent,
	customModeConfigs?: ModeConfig[],
	globalCustomInstructions?: string,
	preferredLanguage?: string,
): Promise<string> {
	if (!context) {
		throw new Error("Extension context is required for generating system prompt")
	}

	const [mcpServersSection, modesSection] = await Promise.all([
		getMcpServersSection(mcpHub, diffStrategy),
		getModesSection(context),
	])

	// Get the full mode config to ensure we have the role definition
	const modeConfig = getModeBySlug(mode, customModeConfigs) || modes.find((m) => m.slug === mode) || modes[0]
	const roleDefinition = modeConfig.roleDefinition

	const basePrompt = `${roleDefinition}

${getSharedToolUseSection()}

${getToolDescriptionsForMode(
	mode,
	cwd,
	supportsComputerUse,
	diffStrategy,
	browserViewportSize,
	mcpHub,
	customModeConfigs,
)}

${getToolUseGuidelinesSection()}

${mcpServersSection}

${getCapabilitiesSection(cwd, supportsComputerUse, mcpHub, diffStrategy)}

${modesSection}

${getRulesSection(cwd, supportsComputerUse, diffStrategy, context)}

${getSystemInfoSection(cwd, mode, customModeConfigs)}

${getObjectiveSection()}

${await addCustomInstructions(modeConfig.customInstructions || "", globalCustomInstructions || "", cwd, mode, { preferredLanguage })}`

	return basePrompt
}

export const SYSTEM_PROMPT = async (
	context: vscode.ExtensionContext,
	cwd: string,
	supportsComputerUse: boolean,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	browserViewportSize?: string,
	mode: Mode = defaultModeSlug,
	customPrompts?: CustomPrompts,
	customModes?: ModeConfig[],
	globalCustomInstructions?: string,
	preferredLanguage?: string,
): Promise<string> => {
	if (!context) {
		throw new Error("Extension context is required for generating system prompt")
	}

	const getPromptComponent = (value: unknown) => {
		if (typeof value === "object" && value !== null) {
			return value as PromptComponent
		}
		return undefined
	}

	// Check if it's a custom mode
	const promptComponent = getPromptComponent(customPrompts?.[mode])
	// Get full mode config from custom modes or fall back to built-in modes
	const currentMode = getModeBySlug(mode, customModes) || modes.find((m) => m.slug === mode) || modes[0]

	return generatePrompt(
		context,
		cwd,
		supportsComputerUse,
		currentMode.slug,
		mcpHub,
		diffStrategy,
		browserViewportSize,
		promptComponent,
		customModes,
		globalCustomInstructions,
		preferredLanguage,
	)
}
