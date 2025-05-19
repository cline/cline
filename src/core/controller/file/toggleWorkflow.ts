import { Controller } from ".."
import { Empty, Metadata } from "../../../shared/proto/common"
import { ToggleWorkflowRequest } from "../../../shared/proto/file"
import { getWorkspaceState, updateWorkspaceState } from "../../../core/storage/state"
import { ClineRulesToggles } from "../../../shared/cline-rules"

/**
 * Toggles a workflow on or off
 * @param controller The controller instance
 * @param request The request containing the workflow path and enabled state
 * @returns Empty response
 */
export async function toggleWorkflow(controller: Controller, request: ToggleWorkflowRequest): Promise<Empty> {
	if (request.workflowPath && typeof request.enabled === "boolean") {
		const toggles = ((await getWorkspaceState(controller.context, "workflowToggles")) as ClineRulesToggles) || {}
		toggles[request.workflowPath] = request.enabled
		await updateWorkspaceState(controller.context, "workflowToggles", toggles)
		await controller.postStateToWebview()
	}
	return Empty.create()
}
