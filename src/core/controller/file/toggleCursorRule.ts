import type { ToggleCursorRuleRequest } from "@shared/proto/cline/file"
import { ClineRulesToggles } from "@shared/proto/cline/file"
import type { Controller } from "../index"

/**
 * Toggles a Cursor rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated Cursor rule toggles
 */
export async function toggleCursorRule(controller: Controller, request: ToggleCursorRuleRequest): Promise<ClineRulesToggles> {
	const { rulePath, enabled } = request

	if (!rulePath || typeof enabled !== "boolean") {
		console.error("toggleCursorRule: Missing or invalid parameters", {
			rulePath,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleCursorRule")
	}

	// Update the toggles in workspace state
	const toggles = controller.stateManager.getWorkspaceStateKey("localCursorRulesToggles")
	toggles[rulePath] = enabled
	controller.stateManager.setWorkspaceState("localCursorRulesToggles", toggles)

	// Get the current state to return in the response
	const cursorToggles = controller.stateManager.getWorkspaceStateKey("localCursorRulesToggles")

	return ClineRulesToggles.create({
		toggles: cursorToggles,
	})
}
