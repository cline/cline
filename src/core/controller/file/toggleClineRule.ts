import type { ToggleClineRuleRequest, ClineRulesToggles, ToggleClineRules } from "../../../shared/proto/file"
import type { Controller } from "../index"
import { getGlobalState, getWorkspaceState, updateGlobalState, updateWorkspaceState } from "../../../core/storage/state"
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
		const toggles = ((await getGlobalState(controller.context, "globalClineRulesToggles")) as AppClineRulesToggles) || {}
		toggles[rulePath] = enabled
		await updateGlobalState(controller.context, "globalClineRulesToggles", toggles)
	} else {
		const toggles = ((await getWorkspaceState(controller.context, "localClineRulesToggles")) as AppClineRulesToggles) || {}
		toggles[rulePath] = enabled
		await updateWorkspaceState(controller.context, "localClineRulesToggles", toggles)
	}

	// Get the current state to return in the response
	const globalToggles = ((await getGlobalState(controller.context, "globalClineRulesToggles")) as AppClineRulesToggles) || {}
	const localToggles = ((await getWorkspaceState(controller.context, "localClineRulesToggles")) as AppClineRulesToggles) || {}

	return {
		globalClineRulesToggles: { toggles: globalToggles },
		localClineRulesToggles: { toggles: localToggles },
	}
}
