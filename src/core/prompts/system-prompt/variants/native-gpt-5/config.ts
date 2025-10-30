import { isGPT5ModelFamily, isNextGenModelProvider } from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { GPT_5_TEMPLATE_OVERRIDES } from "./template"

// Type-safe variant configuration using the builder pattern
export const config = createVariant(ModelFamily.NATIVE_GPT_5)
	.description("Prompt tailored to GPT-5 with native tool use support")
	.version(1)
	.tags("gpt", "gpt-5", "advanced", "production", "native_tools")
	.labels({
		stable: 1,
		production: 1,
		advanced: 1,
		use_native_tools: 1,
	})
	// Match GPT-5 models from providers that support native tools
	.matcher((context) => {
		if (!context.enableNativeToolCalls) {
			return false
		}
		const providerInfo = context.providerInfo
		const modelId = providerInfo.model.id

		// gpt-5-chat models do not support native tool use
		return isGPT5ModelFamily(modelId) && !modelId.includes("chat") && isNextGenModelProvider(providerInfo)
	})
	.template(GPT_5_TEMPLATE_OVERRIDES.BASE)
	.components(
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.TODO,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.CLI_SUBAGENTS,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.FEEDBACK,
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
		ClineDefaultTool.MCP_ACCESS,
		ClineDefaultTool.ASK,
		ClineDefaultTool.ATTEMPT,
		ClineDefaultTool.NEW_TASK,
		ClineDefaultTool.PLAN_MODE,
		ClineDefaultTool.MCP_DOCS,
		ClineDefaultTool.TODO,
	)
	.placeholders({
		MODEL_FAMILY: ModelFamily.NATIVE_GPT_5,
	})
	.config({})
	// Override the RULES component with custom template
	.overrideComponent(SystemPromptSection.RULES, {
		template: GPT_5_TEMPLATE_OVERRIDES.RULES,
	})
	.overrideComponent(SystemPromptSection.TOOL_USE, {
		template: GPT_5_TEMPLATE_OVERRIDES.TOOL_USE,
	})
	.overrideComponent(SystemPromptSection.ACT_VS_PLAN, {
		template: GPT_5_TEMPLATE_OVERRIDES.ACT_VS_PLAN,
	})
	.overrideComponent(SystemPromptSection.OBJECTIVE, {
		template: GPT_5_TEMPLATE_OVERRIDES.OBJECTIVE,
	})
	.overrideComponent(SystemPromptSection.FEEDBACK, {
		template: GPT_5_TEMPLATE_OVERRIDES.FEEDBACK,
	})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: ModelFamily.NATIVE_GPT_5 }, { strict: true })
if (!validationResult.isValid) {
	console.error("GPT-5 variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid GPT-5 variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	console.warn("GPT-5 variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type GPT5VariantConfig = typeof config
