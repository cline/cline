import { Controller } from ".."
import { Metadata } from "../../../shared/proto/common"
import { ToggleWorkflowRequest, ClineRulesToggles } from "../../../shared/proto/file"
import { getWorkspaceState, updateWorkspaceState } from "../../../core/storage/state"
import { ClineRulesToggles as AppClineRulesToggles } from "../../../shared/cline-rules"

/**
 * Toggles a workflow on or off
 * @param controller The controller instance
 * @param request The request containing the workflow path and enabled state
 * @returns The updated workflow toggles
 */
export async function toggleWorkflow(controller: Controller, request: ToggleWorkflowRequest): Promise<ClineRulesToggles> {
	const { workflowPath, enabled } = request

	if (!workflowPath || typeof enabled !== "boolean") {
		console.error("toggleWorkflow: Missing or invalid parameters", {
			workflowPath,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleWorkflow")
	}

	// Update the toggles
	const toggles = ((await getWorkspaceState(controller.context, "workflowToggles")) as AppClineRulesToggles) || {}
	toggles[workflowPath] = enabled
	await updateWorkspaceState(controller.context, "workflowToggles", toggles)
	await controller.postStateToWebview()

	// Return the toggles directly
	return { toggles: toggles }
}
