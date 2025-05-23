import type { ToggleCursorRuleRequest, ClineRulesToggles } from "../../../shared/proto/file"
import type { Controller } from "../index"
import { getWorkspaceState, updateWorkspaceState } from "../../../core/storage/state"
import { ClineRulesToggles as AppClineRulesToggles } from "@shared/cline-rules"

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
	const toggles = ((await getWorkspaceState(controller.context, "localCursorRulesToggles")) as AppClineRulesToggles) || {}
	toggles[rulePath] = enabled
	await updateWorkspaceState(controller.context, "localCursorRulesToggles", toggles)

	// Get the current state to return in the response
	const cursorToggles = ((await getWorkspaceState(controller.context, "localCursorRulesToggles")) as AppClineRulesToggles) || {}

	return {
		toggles: cursorToggles,
	}
}
