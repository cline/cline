import { getWorkspaceBasename } from "@core/workspace"
import type { ToggleClineRuleRequest } from "@shared/proto/cline/file"
import { ToggleClineRules } from "@shared/proto/cline/file"
import { telemetryService } from "@/services/telemetry"
import type { Controller } from "../index"

/**
 * Toggles a AI-Hydro rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated AI-Hydro rule toggles
 */
export async function toggleAiHydroRule(controller: Controller, request: ToggleClineRuleRequest): Promise<ToggleClineRules> {
	const { isGlobal, rulePath, enabled } = request

	if (!rulePath || typeof enabled !== "boolean" || typeof isGlobal !== "boolean") {
		console.error("toggleAiHydroRule: Missing or invalid parameters", {
			rulePath,
			isGlobal: typeof isGlobal === "boolean" ? isGlobal : `Invalid: ${typeof isGlobal}`,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleAiHydroRule")
	}

	// This is the same core logic as in the original handler
	if (isGlobal) {
		const toggles = controller.stateManager.getGlobalSettingsKey("globalAiHydroRulesToggles")
		toggles[rulePath] = enabled
		controller.stateManager.setGlobalState("globalAiHydroRulesToggles", toggles)
	} else {
		const toggles = controller.stateManager.getWorkspaceStateKey("localAiHydroRulesToggles")
		toggles[rulePath] = enabled
		controller.stateManager.setWorkspaceState("localAiHydroRulesToggles", toggles)
	}

	// Track rule toggle telemetry with current task context
	if (controller.task?.ulid) {
		// Extract just the filename for privacy (no full paths)
		const ruleFileName = getWorkspaceBasename(rulePath, "Controller.toggleAiHydroRule")
		telemetryService.captureAiHydroRuleToggled(controller.task.ulid, ruleFileName, enabled, isGlobal)
	}

	// Get the current state to return in the response
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalAiHydroRulesToggles")
	const localToggles = controller.stateManager.getWorkspaceStateKey("localAiHydroRulesToggles")

	// ToggleClineRules is shared with toggleClineRule (a separate, real RPC for
	// the .clinerules feature) -- populate only the AI-Hydro-named fields here.
	return ToggleClineRules.create({
		globalAiHydroRulesToggles: { toggles: globalToggles },
		localAiHydroRulesToggles: { toggles: localToggles },
	})
}
