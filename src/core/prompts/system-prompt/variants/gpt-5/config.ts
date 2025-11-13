import { isGPT5ModelFamily, isNextGenModelProvider } from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { PromptVariant, SystemPromptContext } from "../../types"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { GPT_5_TEMPLATE_OVERRIDES } from "./template"

// Type-safe variant configuration using the builder pattern
export const config = (context: SystemPromptContext) => {
	let componentOverrides: PromptVariant["componentOverrides"] = {}
	if (context.providerInfo?.model?.info?.canUseTools && context.enableNativeToolCalls) {
		componentOverrides = {
			RULES_SECTION: {
				template: GPT_5_TEMPLATE_OVERRIDES.RULES_NATIVETOOLS,
			},
			TOOL_USE_SECTION: {
				template: GPT_5_TEMPLATE_OVERRIDES.TOOL_USE,
			},
			ACT_VS_PLAN_SECTION: {
				template: GPT_5_TEMPLATE_OVERRIDES.ACT_VS_PLAN,
			},
			OBJECTIVE_SECTION: {
				template: GPT_5_TEMPLATE_OVERRIDES.OBJECTIVE,
			},
			FEEDBACK_SECTION: {
				template: GPT_5_TEMPLATE_OVERRIDES.FEEDBACK,
			},
			EDITING_FILES_SECTION: {
				enabled: false,
			},
		}
	} else {
		componentOverrides = {
			RULES_SECTION: {
				template: GPT_5_TEMPLATE_OVERRIDES.RULES,
			},
		}
	}

	const variant = createVariant(ModelFamily.GPT_5, context)
		.description("Prompt tailored to GPT-5 with text-based tools")
		.version(1)
		.tags("gpt", "gpt-5", "advanced", "production")
		.labels({
			stable: 1,
			production: 1,
			advanced: 1,
		})
		// Match GPT-5 models
		.matcher((context) => {
			const providerInfo = context.providerInfo
			const modelId = providerInfo.model.id
			return isGPT5ModelFamily(modelId) && !modelId.includes("chat") && isNextGenModelProvider(providerInfo)
		})
		.template(GPT_5_TEMPLATE_OVERRIDES.BASE)
		.components(createComponentsFn)
		.tools(createToolsFn)
		.placeholders({
			MODEL_FAMILY: ModelFamily.GPT_5,
		})
		.config({})
		// Override the RULES component with custom template
		.overrideComponents(componentOverrides)
		.build()

	// Validation
	const validationResult = validateVariant({ ...variant, id: ModelFamily.GPT_5 }, { strict: true })
	if (!validationResult.isValid) {
		console.error("GPT-5 variant configuration validation failed:", validationResult.errors)
		throw new Error(`Invalid GPT-5 variant configuration: ${validationResult.errors.join(", ")}`)
	}

	if (validationResult.warnings.length > 0) {
		console.warn("GPT-5 variant configuration warnings:", validationResult.warnings)
	}

	return variant
}

const createComponentsFn: (context: SystemPromptContext) => SystemPromptSection[] = (context: SystemPromptContext) => {
	const inlineTools = !(context.providerInfo.model.info.canUseTools && context.enableNativeToolCalls)
	const base = [
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.TASK_PROGRESS,
		inlineTools && SystemPromptSection.MCP,
		inlineTools && SystemPromptSection.EDITING_FILES,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.CLI_SUBAGENTS,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.FEEDBACK,
		SystemPromptSection.RULES,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.USER_INSTRUCTIONS,
	]
	return base.filter((x) => !!x)
}

const createToolsFn: (context: SystemPromptContext) => ClineDefaultTool[] = (context: SystemPromptContext) => {
	const inlineTools = !(context.providerInfo.model.info.canUseTools && context.enableNativeToolCalls)
	const base = [
		ClineDefaultTool.BASH,
		ClineDefaultTool.FILE_READ,
		ClineDefaultTool.FILE_NEW,
		ClineDefaultTool.FILE_EDIT,
		ClineDefaultTool.SEARCH,
		ClineDefaultTool.LIST_FILES,
		ClineDefaultTool.LIST_CODE_DEF,
		ClineDefaultTool.BROWSER,
		ClineDefaultTool.WEB_FETCH,
		inlineTools && ClineDefaultTool.MCP_USE,
		ClineDefaultTool.MCP_ACCESS,
		ClineDefaultTool.ASK,
		ClineDefaultTool.ATTEMPT,
		ClineDefaultTool.NEW_TASK,
		ClineDefaultTool.PLAN_MODE,
		ClineDefaultTool.MCP_DOCS,
		ClineDefaultTool.TODO,
	]
	return base.filter((x) => !!x)
}

// Export type information for better IDE support
export type GPT5VariantConfig = typeof config
