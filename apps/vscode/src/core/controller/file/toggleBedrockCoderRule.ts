import type { ToggleBedrockCoderRuleRequest } from "@shared/proto/bedrock_coder/file"
import { RuleScope, ToggleBedrockCoderRules } from "@shared/proto/bedrock_coder/file"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Toggles a BedrockCoder rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated BedrockCoder rule toggles
 */
export async function toggleBedrockCoderRule(
	controller: Controller,
	request: ToggleBedrockCoderRuleRequest,
): Promise<ToggleBedrockCoderRules> {
	const { scope, rulePath, enabled } = request

	if (!rulePath || typeof enabled !== "boolean" || scope === undefined) {
		Logger.error("toggleBedrock CoderRule: Missing or invalid parameters", {
			rulePath,
			scope,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleBedrock CoderRule")
	}

	// Handle local and global scopes.
	switch (scope) {
		case RuleScope.GLOBAL: {
			const toggles = controller.stateManager.getGlobalSettingsKey("globalBedrockCoderRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setGlobalState("globalBedrockCoderRulesToggles", toggles)
			break
		}
		case RuleScope.LOCAL: {
			const toggles = controller.stateManager.getWorkspaceStateKey("localBedrockCoderRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setWorkspaceState("localBedrockCoderRulesToggles", toggles)
			break
		}
		default:
			throw new Error(`Invalid scope: ${scope}`)
	}

	// Get the current state to return in the response
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalBedrockCoderRulesToggles")
	const localToggles = controller.stateManager.getWorkspaceStateKey("localBedrockCoderRulesToggles")
	return ToggleBedrockCoderRules.create({
		globalBedrockCoderRulesToggles: { toggles: globalToggles },
		localBedrockCoderRulesToggles: { toggles: localToggles },
	})
}
