import type { ToggleWindsurfRuleRequest } from "../../../shared/proto/file"
import { ClineRulesToggles } from "../../../shared/proto/file"
import type { Controller } from "../index"
import { getWorkspaceState, updateWorkspaceState } from "../../../core/storage/state"
import { ClineRulesToggles as AppClineRulesToggles } from "@shared/cline-rules"

/**
 * Toggles a Windsurf rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated Windsurf rule toggles
 */
export async function toggleWindsurfRule(controller: Controller, request: ToggleWindsurfRuleRequest): Promise<ClineRulesToggles> {
	const { rulePath, enabled } = request

	if (!rulePath || typeof enabled !== "boolean") {
		console.error("toggleWindsurfRule: Missing or invalid parameters", {
			rulePath,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleWindsurfRule")
	}

	// Update the toggles
	const toggles = ((await getWorkspaceState(controller.context, "localWindsurfRulesToggles")) as AppClineRulesToggles) || {}
	toggles[rulePath] = enabled
	await updateWorkspaceState(controller.context, "localWindsurfRulesToggles", toggles)

	// Return the toggles directly
	return ClineRulesToggles.create({ toggles: toggles })
}
