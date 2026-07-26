import type { ToggleClineRuleRequest } from "@shared/proto/cline/file"
import { RuleScope, ToggleClineRules } from "@shared/proto/cline/file"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Toggles a Cline rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated Cline rule toggles
 */
export async function toggleClineRule(controller: Controller, request: ToggleClineRuleRequest): Promise<ToggleClineRules> {
	const { scope, rulePath, enabled } = request

	if (!rulePath || typeof enabled !== "boolean" || scope === undefined) {
		Logger.error("toggleClineRule: Missing or invalid parameters", {
			rulePath,
			scope,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleClineRule")
	}

	// Handle local and global scopes.
	switch (scope) {
		case RuleScope.GLOBAL: {
			const toggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setGlobalState("globalClineRulesToggles", toggles)
			break
		}
		case RuleScope.LOCAL: {
			const toggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setWorkspaceState("localClineRulesToggles", toggles)
			break
		}
		default:
			throw new Error(`Invalid scope: ${scope}`)
	}

	// Get the current state to return in the response
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
	const localToggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
	return ToggleClineRules.create({
		globalClineRulesToggles: { toggles: globalToggles },
		localClineRulesToggles: { toggles: localToggles },
	})
}
