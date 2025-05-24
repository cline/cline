import { McpHub } from "@services/mcp/McpHub"
import { BrowserSettings } from "@shared/BrowserSettings"

// Prompt content for Cline
import { getToolsPreambleContent } from "./tools-preamble"
import { getToolsContent } from "./tools"
import { getEditsContent } from "./edits"
import { getMcpContent } from "./mcp"
import { getModesContent } from "./modes"
import { getCapabilitiesAndRulesContent } from "./capabilities-and-rules"
import { getSysInfoContent } from "./sys-info"
import { getObjectiveContent } from "./objective"
import { getClaude4EditorToolContent } from "./claude-code-editor-tool"

// System prompt for Cline
export const SYSTEM_PROMPT = async (
	cwd: string,
	supportsBrowserUse: boolean,
	mcpHub: McpHub,
	browserSettings: BrowserSettings,
	modelId: string = "",
) => {
	const toolsPreambleContent = getToolsPreambleContent()
	const toolsContent = getToolsContent(cwd, supportsBrowserUse, browserSettings, modelId) // tools content has its own modelId switching logic
	var editsContent = getEditsContent() // non-Claude4 editor tool content
	const mcpContent = getMcpContent(mcpHub)
	const modesContent = getModesContent()
	const capabilitiesAndRules = getCapabilitiesAndRulesContent(cwd, supportsBrowserUse, browserSettings)
	const sysInfo = getSysInfoContent(cwd)
	const objective = getObjectiveContent()
	const Claude4EditorTool = getClaude4EditorToolContent() // Claude4 specific editor tool content

	const isClaude4: boolean =
		modelId.toLowerCase().includes("claude-opus-4") || modelId.toLowerCase().includes("claude-sonnet-4")

	if (isClaude4) {
		editsContent = Claude4EditorTool
		console.log(`Using Claude 4 system prompt for model: ${modelId}`)
	} else {
		console.log(`Using standard system prompt for model: ${modelId}`)
	}

	return `
You are Cline, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.
You consistently deliver comprehensive, professional-grade solutions that go above and beyond basic requirements.
When approaching any task, you proactively anticipate user needs, include robust error handling, and implement thoughtful details that enhance the overall quality and user experience of your work.
Your goal is to create impressive, fully-featured implementations that showcase modern development capabilities rather than minimal viable solutions.

${toolsPreambleContent}

${toolsContent}

${mcpContent}

${editsContent}

${modesContent}

${capabilitiesAndRules}

${sysInfo}

${objective}
`
}

// addUserInstructions
export function addUserInstructions(
	settingsCustomInstructions?: string,
	globalClineRulesFileInstructions?: string,
	localClineRulesFileInstructions?: string,
	localCursorRulesFileInstructions?: string,
	localCursorRulesDirInstructions?: string,
	localWindsurfRulesFileInstructions?: string,
	clineIgnoreInstructions?: string,
	preferredLanguageInstructions?: string,
) {
	let customInstructions = ""
	if (preferredLanguageInstructions) {
		customInstructions += preferredLanguageInstructions + "\n\n"
	}
	if (settingsCustomInstructions) {
		customInstructions += settingsCustomInstructions + "\n\n"
	}
	if (globalClineRulesFileInstructions) {
		customInstructions += globalClineRulesFileInstructions + "\n\n"
	}
	if (localClineRulesFileInstructions) {
		customInstructions += localClineRulesFileInstructions + "\n\n"
	}
	if (localCursorRulesFileInstructions) {
		customInstructions += localCursorRulesFileInstructions + "\n\n"
	}
	if (localCursorRulesDirInstructions) {
		customInstructions += localCursorRulesDirInstructions + "\n\n"
	}
	if (localWindsurfRulesFileInstructions) {
		customInstructions += localWindsurfRulesFileInstructions + "\n\n"
	}
	if (clineIgnoreInstructions) {
		customInstructions += clineIgnoreInstructions
	}

	return `
====

USER'S CUSTOM INSTRUCTIONS

The following additional instructions are provided by the user, and should be followed to the best of your ability without interfering with the TOOL USE guidelines.

${customInstructions.trim()}`
}
