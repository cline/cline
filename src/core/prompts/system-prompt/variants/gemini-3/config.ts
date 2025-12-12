import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { isGemini3ModelFamily, isNextGenModelProvider } from "@/utils/model-utils"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { gemini3ComponentOverrides } from "./overrides"
import { baseTemplate } from "./template"

export const config = createVariant(ModelFamily.GEMINI_3)
	.description("Prompt optimized for Gemini 3.0 model with native tool calling support.")
	.version(1)
	.tags("gemini 3.0", "stable", "native_tools")
	.labels({
		stable: 1,
		production: 1,
		use_native_tools: 1,
	})
	.matcher((context) => {
		if (!context.enableNativeToolCalls) {
			return false
		}
		const providerInfo = context.providerInfo
		if (!isNextGenModelProvider(providerInfo)) {
			return false
		}
		const modelId = providerInfo.model.id
		return isGemini3ModelFamily(modelId)
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
		SystemPromptSection.FEEDBACK,
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
		ClineDefaultTool.WEB_FETCH,
		ClineDefaultTool.MCP_USE,
		ClineDefaultTool.MCP_ACCESS,
		ClineDefaultTool.ASK,
		ClineDefaultTool.ATTEMPT,
		ClineDefaultTool.NEW_TASK,
		ClineDefaultTool.PLAN_MODE,
		ClineDefaultTool.ACT_MODE,
		ClineDefaultTool.MCP_DOCS,
		ClineDefaultTool.TODO,
		ClineDefaultTool.GENERATE_EXPLANATION,
	)
	.placeholders({
		MODEL_FAMILY: ModelFamily.GEMINI_3,
	})
	.config({})
	// Apply Gemini 3.0 specific component overrides
	.overrideComponent(SystemPromptSection.AGENT_ROLE, gemini3ComponentOverrides[SystemPromptSection.AGENT_ROLE]!)
	.overrideComponent(SystemPromptSection.TOOL_USE, gemini3ComponentOverrides[SystemPromptSection.TOOL_USE]!)
	.overrideComponent(SystemPromptSection.EDITING_FILES, gemini3ComponentOverrides[SystemPromptSection.EDITING_FILES]!)
	.overrideComponent(SystemPromptSection.OBJECTIVE, gemini3ComponentOverrides[SystemPromptSection.OBJECTIVE]!)
	.overrideComponent(SystemPromptSection.RULES, gemini3ComponentOverrides[SystemPromptSection.RULES]!)
	.overrideComponent(SystemPromptSection.FEEDBACK, gemini3ComponentOverrides[SystemPromptSection.FEEDBACK]!)
	.overrideComponent(SystemPromptSection.ACT_VS_PLAN, gemini3ComponentOverrides[SystemPromptSection.ACT_VS_PLAN]!)
	.overrideComponent(SystemPromptSection.TASK_PROGRESS, gemini3ComponentOverrides[SystemPromptSection.TASK_PROGRESS]!)
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "gemini3" }, { strict: true })
if (!validationResult.isValid) {
	console.error("Gemini 3.0 variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid Gemini 3.0 variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	console.warn("Gemini 3.0 variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type Gemini3VariantConfig = typeof config
