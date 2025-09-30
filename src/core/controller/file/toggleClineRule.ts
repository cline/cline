import { getWorkspaceBasename } from "@core/workspace"
import type { ToggleClineRuleRequest } from "@shared/proto/cline/file"
import { ToggleClineRules } from "@shared/proto/cline/file"
import { telemetryService } from "@/services/telemetry"
import type { Controller } from "../index"

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
		const toggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
		toggles[rulePath] = enabled
		controller.stateManager.setGlobalState("globalClineRulesToggles", toggles)
	} else {
		const toggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
		toggles[rulePath] = enabled
		controller.stateManager.setWorkspaceState("localClineRulesToggles", toggles)
	}

	// Track rule toggle telemetry with current task context
	if (controller.task?.ulid) {
		// Extract just the filename for privacy (no full paths)
		const ruleFileName = getWorkspaceBasename(rulePath, "Controller.toggleClineRule")
		telemetryService.captureClineRuleToggled(controller.task.ulid, ruleFileName, enabled, isGlobal)
	}

	// Get the current state to return in the response
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
	const localToggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")

	return ToggleClineRules.create({
		globalClineRulesToggles: { toggles: globalToggles },
		localClineRulesToggles: { toggles: localToggles },
	})
}
