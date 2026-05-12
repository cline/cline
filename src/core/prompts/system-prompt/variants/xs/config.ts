import { isLocalModel, isMacM4LocalModel } from "@utils/model-utils"
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
		// MacM4LocalAgent local-tier models always get the compact prompt:
		// their context windows (16K for local-fast, 131K for local-long) and
		// instruction-following ceiling mean the full ~13.5K-token Cline
		// system prompt either won't fit or wastes a third of the budget on
		// tool docs the model can't reliably use. Forcing the xs variant
		// drops the prompt to ~3-5K tokens.
		if (isMacM4LocalModel(providerInfo)) {
			return true
		}
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
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.EDITING_FILES,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.USER_INSTRUCTIONS,
		SystemPromptSection.SKILLS,
	)
	// Tool allowlist for small / local models. Each exclusion costs a
	// non-trivial number of tokens at prompt-build time (the tool's
	// XML schema lives in the system prompt), and each exclusion is
	// also a capability we judge the target model cannot reliably
	// drive. Order in the list is preserved for matcher fallback.
	//
	// Intentionally EXCLUDED for the XS / MacM4 local tier:
	//   BROWSER         -- Puppeteer-driven UI automation; 7B-80B local
	//                      models hallucinate coordinates and fail. The
	//                      tool description costs ~2K tokens.
	//   MCP_USE/_ACCESS -- MCP tool catalogues are user-installed and
	//                      can balloon the prompt unbounded; xs cannot
	//                      reliably select among many tools.
	//   WEB_FETCH       -- Needs structured JSON tool args local models
	//                      get wrong; user can invoke via BASH+curl.
	//   USE_SUBAGENTS   -- Subagent orchestration requires strong
	//                      multi-step planning that even Qwen3-Coder-Next
	//                      80B does inconsistently. ~1K tokens of doc.
	//   LIST_CODE_DEF   -- Local model rarely benefits over SEARCH+FILE_READ.
	//   NEW_TASK        -- Spawning sub-tasks isn't reliably handled.
	//   APPLY_PATCH     -- Patch-format edits are over-generation-prone;
	//                      FILE_EDIT (replace_in_file) is safer for xs.
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
		// BROWSER capability suppression: xs already overrides
		// SystemPromptSection.CAPABILITIES below (see .overrideComponent
		// call) AND omits BROWSER from the tool allowlist above. Both
		// gates run *before* the SUPPORTS_BROWSER placeholder would
		// have an effect, so an explicit override here is redundant.
		// Kept this comment as a paper trail: don't re-add a
		// `SUPPORTS_BROWSER: false` line -- the placeholders() signature
		// is Record<string, string> and the existing gates already
		// achieve the desired prompt-budget invariance.
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
