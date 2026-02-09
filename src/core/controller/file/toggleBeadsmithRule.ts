import { getWorkspaceBasename } from "@core/workspace"
import type { ToggleBeadsmithRuleRequest } from "@shared/proto/beadsmith/file"
import { RuleScope, ToggleBeadsmithRules } from "@shared/proto/beadsmith/file"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Toggles a Beadsmith rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated Beadsmith rule toggles
 */
export async function toggleBeadsmithRule(
	controller: Controller,
	request: ToggleBeadsmithRuleRequest,
): Promise<ToggleBeadsmithRules> {
	const { scope, rulePath, enabled } = request

	if (!rulePath || typeof enabled !== "boolean" || scope === undefined) {
		Logger.error("toggleBeadsmithRule: Missing or invalid parameters", {
			rulePath,
			scope,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleBeadsmithRule")
	}

	// Handle the three different scopes
	switch (scope) {
		case RuleScope.GLOBAL: {
			const toggles = controller.stateManager.getGlobalSettingsKey("globalBeadsmithRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setGlobalState("globalBeadsmithRulesToggles", toggles)
			break
		}
		case RuleScope.LOCAL: {
			const toggles = controller.stateManager.getWorkspaceStateKey("localBeadsmithRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setWorkspaceState("localBeadsmithRulesToggles", toggles)
			break
		}
		case RuleScope.REMOTE: {
			const toggles = controller.stateManager.getGlobalStateKey("remoteRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setGlobalState("remoteRulesToggles", toggles)
			break
		}
		default:
			throw new Error(`Invalid scope: ${scope}`)
	}

	// Track rule toggle telemetry with current task context
	if (controller.task?.ulid) {
		// Extract just the filename for privacy (no full paths)
		const ruleFileName = getWorkspaceBasename(rulePath, "Controller.toggleBeadsmithRule")
		const isGlobal = scope === RuleScope.GLOBAL
		telemetryService.captureBeadsmithRuleToggled(controller.task.ulid, ruleFileName, enabled, isGlobal)
	}

	// Get the current state to return in the response
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalBeadsmithRulesToggles")
	const localToggles = controller.stateManager.getWorkspaceStateKey("localBeadsmithRulesToggles")
	const remoteToggles = controller.stateManager.getGlobalStateKey("remoteRulesToggles")

	return ToggleBeadsmithRules.create({
		globalBeadsmithRulesToggles: { toggles: globalToggles },
		localBeadsmithRulesToggles: { toggles: localToggles },
		remoteRulesToggles: { toggles: remoteToggles },
	})
}
