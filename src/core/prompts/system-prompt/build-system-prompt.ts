import { McpHub } from "@services/mcp/McpHub"
import { BrowserSettings } from "@shared/BrowserSettings"
import { ApiHandlerModel } from "@/api"
import { GENERIC_SYSTEM_PROMPT } from "./generic-system-prompt"
import { SYSTEM_PROMPT_CLAUDE4 } from "./families/claude-and-opus-4/claude4-system-prompt"
import { SYSTEM_PROMPT_NEXT_GEN } from "./families/next-gen-models/next-gen-system-prompt"
import { isClaude4ModelFamily, isNextGenModelFamily } from "./utils"

export const buildSystemPrompt = async (
	cwd: string,
	supportsBrowserUse: boolean,
	mcpHub: McpHub,
	browserSettings: BrowserSettings,
	apiHandlerModel: ApiHandlerModel,
) => {
	if (isClaude4ModelFamily(apiHandlerModel)) {
		return SYSTEM_PROMPT_CLAUDE4(cwd, supportsBrowserUse, mcpHub, browserSettings)
	}
	// catch all for gemini 2.5, gpt 5, etc.
	// New prompts per family can be added as granularly as we like by adding a folder in the "families" folder and creating a function to discriminate a group of models in the utils.
	else if (isNextGenModelFamily(apiHandlerModel)) {
		return SYSTEM_PROMPT_NEXT_GEN(cwd, supportsBrowserUse, mcpHub, browserSettings)
	} else {
		return GENERIC_SYSTEM_PROMPT(cwd, supportsBrowserUse, mcpHub, browserSettings)
	}
}
