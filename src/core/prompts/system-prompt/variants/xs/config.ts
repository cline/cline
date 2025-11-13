import { isLocalModel } from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { SystemPromptContext } from "../../types"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { xsComponentOverrides } from "./overrides"
import { baseTemplate } from "./template"

// Type-safe variant configuration using the builder pattern
export const config = (context: SystemPromptContext) => {
	const variant = createVariant(ModelFamily.XS, context)
		.description("Prompt for models with a small context window.")
		.version(1)
		.tags("local", "xs", "compact")
		.labels({
			stable: 1,
			production: 1,
			advanced: 1,
		})
		.matcher((context) => {
			const providerInfo = context.providerInfo
			// Match compact local models
			return providerInfo.customPrompt === "compact" && isLocalModel(providerInfo)
		})
		.template(baseTemplate)
		.components([
			SystemPromptSection.AGENT_ROLE,
			SystemPromptSection.RULES,
			SystemPromptSection.ACT_VS_PLAN,
			SystemPromptSection.CLI_SUBAGENTS,
			SystemPromptSection.CAPABILITIES,
			SystemPromptSection.EDITING_FILES,
			SystemPromptSection.OBJECTIVE,
			SystemPromptSection.SYSTEM_INFO,
			SystemPromptSection.USER_INSTRUCTIONS,
		])
		.tools([
			ClineDefaultTool.BASH,
			ClineDefaultTool.FILE_READ,
			ClineDefaultTool.FILE_NEW,
			ClineDefaultTool.FILE_EDIT,
			ClineDefaultTool.SEARCH,
			ClineDefaultTool.LIST_FILES,
			ClineDefaultTool.ASK,
			ClineDefaultTool.ATTEMPT,
			ClineDefaultTool.NEW_TASK,
			ClineDefaultTool.PLAN_MODE,
		])
		.placeholders({
			MODEL_FAMILY: ModelFamily.XS,
		})
		.config({})
		.overrideComponents(xsComponentOverrides)
		.build()

	// Validation
	const validationResult = validateVariant({ ...variant, id: ModelFamily.XS }, { strict: true })
	if (!validationResult.isValid) {
		console.error("XS variant configuration validation failed:", validationResult.errors)
		throw new Error(`Invalid XS variant configuration: ${validationResult.errors.join(", ")}`)
	}

	if (validationResult.warnings.length > 0) {
		console.warn("XS variant configuration warnings:", validationResult.warnings)
	}

	return variant
}

// Export type information for better IDE support
export type XsVariantConfig = typeof config
