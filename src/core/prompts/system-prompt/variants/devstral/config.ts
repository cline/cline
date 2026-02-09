import { ModelFamily } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import { BeadsmithDefaultTool } from "@/shared/tools"
import { isDevstralModelFamily } from "@/utils/model-utils"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { DEVSTRAL_AGENT_ROLE_TEMPLATE } from "./overrides"
import { baseTemplate } from "./template"

export const config = createVariant(ModelFamily.DEVSTRAL)
	.description("Baseline prompt for Devstral family models")
	.version(1)
	.tags("devstral", "stable")
	.labels({
		stable: 1,
		production: 1,
	})
	.matcher((context) => {
		return isDevstralModelFamily(context.providerInfo.model.id)
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
		BeadsmithDefaultTool.BASH,
		BeadsmithDefaultTool.FILE_READ,
		BeadsmithDefaultTool.FILE_NEW,
		BeadsmithDefaultTool.FILE_EDIT,
		BeadsmithDefaultTool.SEARCH,
		BeadsmithDefaultTool.LIST_FILES,
		BeadsmithDefaultTool.LIST_CODE_DEF,
		BeadsmithDefaultTool.BROWSER,
		BeadsmithDefaultTool.WEB_FETCH,
		BeadsmithDefaultTool.WEB_SEARCH,
		BeadsmithDefaultTool.MCP_USE,
		BeadsmithDefaultTool.MCP_ACCESS,
		BeadsmithDefaultTool.ASK,
		BeadsmithDefaultTool.ATTEMPT,
		BeadsmithDefaultTool.PLAN_MODE,
		BeadsmithDefaultTool.MCP_DOCS,
		BeadsmithDefaultTool.TODO,
		BeadsmithDefaultTool.USE_SKILL,
	)
	.placeholders({
		MODEL_FAMILY: "devstral",
	})
	.config({})
	.overrideComponent(SystemPromptSection.AGENT_ROLE, {
		template: DEVSTRAL_AGENT_ROLE_TEMPLATE,
	})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "devstral" }, { strict: true })
if (!validationResult.isValid) {
	Logger.error("Devstral variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid Devstral variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	Logger.warn("Devstral variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type DevstralVariantConfig = typeof config
