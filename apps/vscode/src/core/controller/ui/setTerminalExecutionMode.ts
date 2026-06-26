import { BooleanRequest, KeyValuePair } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Sets the terminal execution mode
 * @param controller The controller instance
 * @param request The request containing whether to enable background execution
 * @returns KeyValuePair with success status
 */
export async function setTerminalExecutionMode(controller: Controller, request: BooleanRequest): Promise<KeyValuePair> {
	const enableBackgroundExec = request.value
	const newMode = enableBackgroundExec ? "backgroundExec" : "vscodeTerminal"
	const previousMode = controller.stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")

	// Update the global state
	controller.stateManager.setGlobalState("vscodeTerminalExecutionMode", newMode)
	;(
		controller as Controller & {
			handleTerminalExecutionModeChanged?: (
				previous: "vscodeTerminal" | "backgroundExec",
				next: "vscodeTerminal" | "backgroundExec",
			) => void
		}
	).handleTerminalExecutionModeChanged?.(previousMode, newMode)

	// Post updated state to webview
	await controller.postStateToWebview()

	return KeyValuePair.create({
		key: "terminalExecutionModeSet",
		value: newMode,
	})
}
