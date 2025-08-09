import { ToggleClineRules } from "@shared/proto/cline/file"
import type { ToggleClineRuleRequest } from "@shared/proto/cline/file"
import type { Controller } from "../index"
import { ClineRulesToggles as AppClineRulesToggles } from "@shared/cline-rules"

/**
 * Toggles a Cline rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated Cline rule toggles
 */
export async function toggleClineRule(controller: Controller, request: ToggleClineRuleRequest): Promise<ToggleClineRules> {
	const { isGlobal, rulePath, enabled } = request

	if (!rulePath || typeof enabled !== "boolean" || typeof isGlobal !== "boolean") {
		console.error("toggleClineRule: Missing or invalid parameters", {
			rulePath,
			isGlobal: typeof isGlobal === "boolean" ? isGlobal : `Invalid: ${typeof isGlobal}`,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleClineRule")
	}

	// This is the same core logic as in the original handler
	if (isGlobal) {
		const toggles = controller.cacheService.getGlobalStateKey("globalClineRulesToggles")
		toggles[rulePath] = enabled
		controller.cacheService.setGlobalState("globalClineRulesToggles", toggles)
	} else {
		const toggles = controller.cacheService.getWorkspaceStateKey("localClineRulesToggles")
		toggles[rulePath] = enabled
		controller.cacheService.setWorkspaceState("localClineRulesToggles", toggles)
	}

	// Get the current state to return in the response
	const globalToggles = controller.cacheService.getGlobalStateKey("globalClineRulesToggles")
	const localToggles = controller.cacheService.getWorkspaceStateKey("localClineRulesToggles")

	return ToggleClineRules.create({
		globalClineRulesToggles: { toggles: globalToggles },
		localClineRulesToggles: { toggles: localToggles },
	})
}
