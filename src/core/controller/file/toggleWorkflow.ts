import { Controller } from ".."
import { ToggleWorkflowRequest, ClineRulesToggles } from "@shared/proto/cline/file"
import { ClineRulesToggles as AppClineRulesToggles } from "../../../shared/cline-rules"

/**
 * Toggles a workflow on or off
 * @param controller The controller instance
 * @param request The request containing the workflow path and enabled state
 * @returns The updated workflow toggles
 */
export async function toggleWorkflow(controller: Controller, request: ToggleWorkflowRequest): Promise<ClineRulesToggles> {
	const { workflowPath, enabled, isGlobal } = request

	if (!workflowPath || typeof enabled !== "boolean") {
		console.error("toggleWorkflow: Missing or invalid parameters", {
			workflowPath,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleWorkflow")
	}

	// Update the toggles based on isGlobal flag
	if (isGlobal) {
		// Global workflows
		const toggles = controller.cacheService.getGlobalStateKey("globalWorkflowToggles")
		toggles[workflowPath] = enabled
		controller.cacheService.setGlobalState("globalWorkflowToggles", toggles)
		await controller.postStateToWebview()

		// Return the global toggles
		return ClineRulesToggles.create({ toggles: toggles })
	} else {
		// Workspace workflows
		const toggles = controller.cacheService.getWorkspaceStateKey("workflowToggles")
		toggles[workflowPath] = enabled
		controller.cacheService.setWorkspaceState("workflowToggles", toggles)
		await controller.postStateToWebview()

		// Return the workspace toggles
		return ClineRulesToggles.create({ toggles: toggles })
	}
}
