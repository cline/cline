import { isLocalModel } from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import { ClineDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { xsComponentOverrides } from "./overrides"
import { baseTemplate } from "./template"

// Type-safe variant configuration using the builder pattern
export const config = createVariant(ModelFamily.XS)
	.description("Prompt for models with a small context window.")
	.version(1)
	.tags("local", "xs", "compact", "native_tools")
	.labels({
		stable: 1,
		production: 1,
		advanced: 1,
		use_native_tools: 1,
	})
	.matcher((context) => {
		const providerInfo = context.providerInfo
		if (!isLocalModel(providerInfo)) {
			return false
		}
		// Match compact local models
		return providerInfo.customPrompt === "compact"
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
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.USER_INSTRUCTIONS,
		SystemPromptSection.SKILLS,
	)
	.tools(
		ClineDefaultTool.BASH,
		ClineDefaultTool.FILE_READ,
		ClineDefaultTool.FILE_NEW,
		ClineDefaultTool.FILE_EDIT,
		ClineDefaultTool.SEARCH,
		ClineDefaultTool.ASK,
		ClineDefaultTool.ATTEMPT,
		ClineDefaultTool.PLAN_MODE,
	)
	.placeholders({
		MODEL_FAMILY: ModelFamily.XS,
	})
	.overrideComponent(SystemPromptSection.AGENT_ROLE, {
		template: xsComponentOverrides.AGENT_ROLE,
	})
	.overrideComponent(SystemPromptSection.TOOL_USE, {
		template: xsComponentOverrides.TOOL_USE,
	})
	.overrideComponent(SystemPromptSection.RULES, {
		template: xsComponentOverrides.RULES,
	})
	.overrideComponent(SystemPromptSection.CLI_SUBAGENTS, {
		template: xsComponentOverrides.CLI_SUBAGENTS,
	})
	.overrideComponent(SystemPromptSection.ACT_VS_PLAN, {
		template: xsComponentOverrides.ACT_VS_PLAN,
	})
	.overrideComponent(SystemPromptSection.CAPABILITIES, {
		template: xsComponentOverrides.CAPABILITIES,
	})
	.overrideComponent(SystemPromptSection.OBJECTIVE, {
		template: xsComponentOverrides.OBJECTIVE,
	})
	.overrideComponent(SystemPromptSection.EDITING_FILES, {
		template: xsComponentOverrides.EDITING_FILES,
	})
	.config({})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: ModelFamily.XS }, { strict: true })
if (!validationResult.isValid) {
	Logger.error("XS variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid XS variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	Logger.warn("XS variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type XsVariantConfig = typeof config
