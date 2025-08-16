import { McpHub } from "@services/mcp/McpHub"
import { BrowserSettings } from "@shared/BrowserSettings"
import { ApiHandlerModel } from "@/api"
import { FocusChainSettings } from "@shared/FocusChainSettings"
import { SYSTEM_PROMPT_GENERIC } from "./generic-system-prompt"
import { SYSTEM_PROMPT_GROK_CODE } from "./families/next-gen-models/grok-code-system-prompt"
import { SYSTEM_PROMPT_NEXT_GEN } from "./families/next-gen-models/next-gen-system-prompt"
import { isGrokCodeModelFamily, isNextGenModelFamily } from "./utils"

export const buildSystemPrompt = async (
	cwd: string,
	supportsBrowserUse: boolean,
	mcpHub: McpHub,
	browserSettings: BrowserSettings,
	apiHandlerModel: ApiHandlerModel,
	focusChainSettings: FocusChainSettings,
) => {
	// New prompts per family can be added as granularly as we like by adding a folder in the "families" folder
	// We then discriminate between families with a functions in the utils.
	if (isGrokCodeModelFamily(apiHandlerModel)) {
		return SYSTEM_PROMPT_GROK_CODE(cwd, supportsBrowserUse, mcpHub, browserSettings, focusChainSettings)
	} else if (isNextGenModelFamily(apiHandlerModel)) {
		return SYSTEM_PROMPT_NEXT_GEN(cwd, supportsBrowserUse, mcpHub, browserSettings, focusChainSettings)
	} else {
		return SYSTEM_PROMPT_GENERIC(cwd, supportsBrowserUse, mcpHub, browserSettings, focusChainSettings)
	}
}
