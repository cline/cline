import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { isMistralModelFamily } from "@/utils/model-utils"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { mistralComponentOverrides } from "./overrides"
import { baseTemplate } from "./template"

export const config = createVariant(ModelFamily.MISTRAL)
	.description("Prompt optimized for Mistral model family with advanced agentic capabilities.")
	.version(1)
	.tags("mistral", "stable")
	.labels({
		stable: 1,
		production: 1,
	})
	.matcher((context) => {
		return isMistralModelFamily(context.providerInfo.model.id)
	})
	.template(baseTemplate)
	.components(
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.RULES,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.CLI_SUBAGENTS,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.EDITING_FILES,
		SystemPromptSection.TODO,
		SystemPromptSection.MCP,
		SystemPromptSection.TASK_PROGRESS,
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
		ClineDefaultTool.MCP_USE,
		ClineDefaultTool.MCP_ACCESS,
		ClineDefaultTool.ASK,
		ClineDefaultTool.ATTEMPT,
		ClineDefaultTool.NEW_TASK,
		ClineDefaultTool.PLAN_MODE,
		ClineDefaultTool.MCP_DOCS,
		ClineDefaultTool.TODO,
	)
	.placeholders({
		MODEL_FAMILY: ModelFamily.MISTRAL,
	})
	.config({})
	// Apply Mistral-specific component overrides
	.overrideComponent(SystemPromptSection.TOOL_USE, mistralComponentOverrides[SystemPromptSection.TOOL_USE])
	.overrideComponent(SystemPromptSection.OBJECTIVE, mistralComponentOverrides[SystemPromptSection.OBJECTIVE])
	.overrideComponent(SystemPromptSection.RULES, mistralComponentOverrides[SystemPromptSection.RULES])
	.overrideComponent(SystemPromptSection.MCP, mistralComponentOverrides[SystemPromptSection.MCP])
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "mistral" }, { strict: true })
if (!validationResult.isValid) {
	console.error("Mistral variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid Mistral variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	console.warn("Mistral variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type MistralVariantConfig = typeof config
