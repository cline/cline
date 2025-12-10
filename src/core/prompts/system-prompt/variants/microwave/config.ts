import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { isMicrowaveModelFamily } from "@/utils/model-utils"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { MICROWAVE_AGENT_ROLE_TEMPLATE } from "./overrides"
import { baseTemplate } from "./template"

export const config = createVariant(ModelFamily.MICROWAVE)
	.description("Baseline prompt for Microwave stealth family models")
	.version(1)
	.tags("microwave", "stable")
	.labels({
		stable: 1,
		production: 1,
	})
	.matcher((context) => {
		return isMicrowaveModelFamily(context.providerInfo.model.id)
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
		ClineDefaultTool.WEB_FETCH,
		ClineDefaultTool.WEB_SEARCH,
		ClineDefaultTool.MCP_USE,
		ClineDefaultTool.MCP_ACCESS,
		ClineDefaultTool.ASK,
		ClineDefaultTool.ATTEMPT,
		ClineDefaultTool.PLAN_MODE,
		ClineDefaultTool.MCP_DOCS,
		ClineDefaultTool.TODO,
	)
	.placeholders({
		MODEL_FAMILY: "microwave",
	})
	.config({})
	.overrideComponent(SystemPromptSection.AGENT_ROLE, {
		template: MICROWAVE_AGENT_ROLE_TEMPLATE,
	})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "microwave" }, { strict: true })
if (!validationResult.isValid) {
	console.error("Microwave variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid Microwave variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	console.warn("Microwave variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type MicrowaveVariantConfig = typeof config
