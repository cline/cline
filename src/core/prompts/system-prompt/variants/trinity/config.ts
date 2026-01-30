import { isTrinityModelFamily } from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import { ClineDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { trinityComponentOverrides } from "./overrides"
import { baseTemplate } from "./template"

export const config = createVariant(ModelFamily.TRINITY)
	.description(
		"Prompt optimized for Trinity models with tool-use optimizations (explicit ask_followup_question question parameter, anti-looping reminder).",
	)
	.version(1)
	.tags("trinity", "stable")
	.labels({
		stable: 1,
		production: 1,
	})
	.matcher((context) => {
		return isTrinityModelFamily(context.providerInfo.model.id)
	})
	.template(baseTemplate)
	.components(
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.TASK_PROGRESS,
		SystemPromptSection.MCP,
		SystemPromptSection.EDITING_FILES,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.CLI_SUBAGENTS,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.RULES,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.USER_INSTRUCTIONS,
		SystemPromptSection.SKILLS,
	)
	.tools(
		ClineDefaultTool.BASH,
		ClineDefaultTool.FILE_READ,
		ClineDefaultTool.FILE_NEW,
		ClineDefaultTool.FILE_EDIT,
		ClineDefaultTool.SEARCH,
		ClineDefaultTool.LIST_FILES,
		ClineDefaultTool.LIST_CODE_DEF,
		ClineDefaultTool.BROWSER,
		ClineDefaultTool.MCP_USE,
		ClineDefaultTool.MCP_ACCESS,
		ClineDefaultTool.ASK,
		ClineDefaultTool.ATTEMPT,
		ClineDefaultTool.PLAN_MODE,
		ClineDefaultTool.MCP_DOCS,
		ClineDefaultTool.TODO,
		ClineDefaultTool.GENERATE_EXPLANATION,
		ClineDefaultTool.USE_SKILL,
	)
	.placeholders({
		MODEL_FAMILY: ModelFamily.TRINITY,
	})
	.config({})
	.overrideComponent(SystemPromptSection.TOOL_USE, trinityComponentOverrides[SystemPromptSection.TOOL_USE]!)
	.overrideComponent(SystemPromptSection.RULES, trinityComponentOverrides[SystemPromptSection.RULES]!)
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "trinity" }, { strict: true })
if (!validationResult.isValid) {
	Logger.error("Trinity variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid Trinity variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	Logger.warn("Trinity variant configuration warnings:", validationResult.warnings)
}

export type TrinityVariantConfig = typeof config
