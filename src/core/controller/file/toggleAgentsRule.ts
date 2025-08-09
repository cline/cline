import type { ToggleAgentsRuleRequest } from "@shared/proto/cline/file"
import { ClineRulesToggles } from "@shared/proto/cline/file"
import type { Controller } from "../index"
import { getWorkspaceState, updateWorkspaceState } from "../../../core/storage/state"
import { ClineRulesToggles as AppClineRulesToggles } from "@shared/cline-rules"

/**
 * Toggles an AGENTS.md rule (enable or disable)
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

	// Update the toggles
	const toggles = ((await getWorkspaceState(controller.context, "localAgentsRulesToggles")) as AppClineRulesToggles) || {}
	toggles[rulePath] = enabled
	await updateWorkspaceState(controller.context, "localAgentsRulesToggles", toggles)

	// Return the toggles directly
	return ClineRulesToggles.create({ toggles: toggles })
}
