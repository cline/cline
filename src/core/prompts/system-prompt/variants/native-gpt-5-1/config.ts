import { isGPT51Model, isGPT52Model, isNextGenModelProvider } from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { gpt51ComponentOverrides } from "./overrides"
import { GPT_5_1_TEMPLATE_OVERRIDES } from "./template"

// Type-safe variant configuration using the builder pattern
export const config = createVariant(ModelFamily.NATIVE_GPT_5_1)
	.description("Prompt tailored to GPT-5.1 and GPT-5.2 with native tool use support")
	.version(1)
	.tags("gpt", "gpt-5-1", "gpt-5-2", "advanced", "production", "native_tools")
	.labels({
		stable: 1,
		production: 1,
		advanced: 1,
		use_native_tools: 1,
	})
	// Match GPT-5.1 and GPT-5.2 models from providers that support native tools
	.matcher((context) => {
		if (!context.enableNativeToolCalls) {
			return false
		}
		const providerInfo = context.providerInfo
		const modelId = providerInfo.model.id

		// Codex variants will use GPT-5 variant instead for less strict rules.
		// Chat variants do not support native tool use.
		if (modelId.includes("codex") && !modelId.includes("chat")) {
			return false
		}

		// gpt-5.1 and gpt-5.2 chat models do not support native tool use
		return (isGPT51Model(modelId) || isGPT52Model(modelId)) && isNextGenModelProvider(providerInfo)
	})
	.template(GPT_5_1_TEMPLATE_OVERRIDES.BASE)
	.components(
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.TASK_PROGRESS,
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
		// Should disable FILE_NEW and FILE_EDIT when enabled
		ClineDefaultTool.APPLY_PATCH,
		ClineDefaultTool.SEARCH,
		ClineDefaultTool.LIST_FILES,
		ClineDefaultTool.LIST_CODE_DEF,
		ClineDefaultTool.BROWSER,
		ClineDefaultTool.WEB_FETCH,
		ClineDefaultTool.WEB_SEARCH,
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
		MODEL_FAMILY: ModelFamily.NATIVE_GPT_5_1,
	})
	.config({})
	// Override components with custom templates from overrides.ts
	.overrideComponent(SystemPromptSection.AGENT_ROLE, gpt51ComponentOverrides[SystemPromptSection.AGENT_ROLE]!)
	.overrideComponent(SystemPromptSection.RULES, gpt51ComponentOverrides[SystemPromptSection.RULES]!)
	.overrideComponent(SystemPromptSection.TOOL_USE, gpt51ComponentOverrides[SystemPromptSection.TOOL_USE]!)
	.overrideComponent(SystemPromptSection.ACT_VS_PLAN, gpt51ComponentOverrides[SystemPromptSection.ACT_VS_PLAN]!)
	.overrideComponent(SystemPromptSection.OBJECTIVE, gpt51ComponentOverrides[SystemPromptSection.OBJECTIVE]!)
	.overrideComponent(SystemPromptSection.FEEDBACK, gpt51ComponentOverrides[SystemPromptSection.FEEDBACK]!)
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: ModelFamily.NATIVE_GPT_5_1 }, { strict: true })
if (!validationResult.isValid) {
	console.error("GPT-5-1 variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid GPT-5-1 variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	console.warn("GPT-5-1 variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type GPT51VariantConfig = typeof config
