import { ApiHandlerModel } from "@core/api"
import { McpHub } from "@services/mcp/McpHub"
import { BrowserSettings } from "@shared/BrowserSettings"
import { FocusChainSettings } from "@shared/FocusChainSettings"
import { is } from "node_modules/cheerio/dist/esm/api/traversing"
import { SYSTEM_PROMPT_GPT_5 } from "./families/next-gen-models/gpt-5"
import { SYSTEM_PROMPT_NEXT_GEN } from "./families/next-gen-models/next-gen-system-prompt"
import { SYSTEM_PROMPT_GENERIC } from "./generic-system-prompt"
import { isGPT5ModelFamily, isNextGenModelFamily } from "./utils"

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

	if (isGPT5ModelFamily(apiHandlerModel)) {
		return SYSTEM_PROMPT_GPT_5(cwd, supportsBrowserUse, mcpHub, browserSettings, focusChainSettings)
	}

	if (isNextGenModelFamily(apiHandlerModel)) {
		return SYSTEM_PROMPT_NEXT_GEN(cwd, supportsBrowserUse, mcpHub, browserSettings, focusChainSettings)
	}

	return SYSTEM_PROMPT_GENERIC(cwd, supportsBrowserUse, mcpHub, browserSettings, focusChainSettings)
}
