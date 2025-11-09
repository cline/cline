import { BooleanRequest } from "../../../shared/proto/cline/common"
import { Controller } from ".."

/**
 * Toggle discuss mode on/off
 * @param controller The controller instance
 * @param request The request containing the enabled state
 * @returns BooleanRequest with the new state
 */
export async function setDiscussModeEnabled(controller: Controller, request: BooleanRequest): Promise<BooleanRequest> {
	const enabled = request.value

	// Update global state
	controller.stateManager.setGlobalState("discussModeEnabled", enabled)

	// Notify webview of state change
	await controller.postStateToWebview()

	return BooleanRequest.create({ value: enabled })
}

// Export with PascalCase for code generation
export { setDiscussModeEnabled as SetDiscussModeEnabled }
