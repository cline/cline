import type { ToggleAgentsRuleRequest } from "@shared/proto/cline/file"
import { ClineRulesToggles } from "@shared/proto/cline/file"
import type { Controller } from "../index"

/**
 * Toggles an Agents rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated Agents rule toggles
 */
export async function toggleAgentsRule(controller: Controller, request: ToggleAgentsRuleRequest): Promise<ClineRulesToggles> {
	const { rulePath, enabled } = request

	if (!rulePath || typeof enabled !== "boolean") {
		console.error("toggleAgentsRule: Missing or invalid parameters", {
			rulePath,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleAgentsRule")
	}

	// Update the toggle in workspace state
	const toggles = controller.stateManager.getWorkspaceStateKey("localAgentsRulesToggles")
	toggles[rulePath] = enabled
	controller.stateManager.setWorkspaceState("localAgentsRulesToggles", toggles)

	// Get the current state to return in the response
	const agentsToggles = controller.stateManager.getWorkspaceStateKey("localAgentsRulesToggles")

	return ClineRulesToggles.create({
		toggles: agentsToggles,
	})
}
