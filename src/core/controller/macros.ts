import * as vscode from "vscode"
import { MacroButton } from "../../shared/ExtensionMessage"
import { WebviewMessage } from "../../shared/WebviewMessage"
import { MacroManager } from "../macros"

/**
 * Initialize macro buttons functionality in the controller
 * @param context The VSCode extension context
 * @param webviewProvider The webview provider instance
 * @param sendMessage Function to send messages to the webview
 * @param updateState Function to update the extension state
 */
export function initializeMacros(
	context: vscode.ExtensionContext,
	sendMessage: (message: any) => void,
	updateState: (state: { macroButtons?: MacroButton[] }) => void,
) {
	// Load initial macros on startup
	const macros = MacroManager.getMacros(context)
	updateState({ macroButtons: macros })

	return {
		/**
		 * Handle macro-related messages from the webview
		 */
		handleMacroMessage: async (message: WebviewMessage) => {
			if (message.type === "action" && message.action === "manageMacrosClicked") {
				await MacroManager.openMacroManager(context)
				// Get updated macros after user interaction
				const updatedMacros = MacroManager.getMacros(context)
				updateState({ macroButtons: updatedMacros })

				// Notify the webview about the updated macros
				sendMessage({
					type: "macroButtonsUpdated",
					macroButtons: updatedMacros,
				})

				return true
			}

			if (message.type === "updateMacroButtons") {
				if (message.macroButtons) {
					await MacroManager.saveMacros(context, message.macroButtons)
					updateState({ macroButtons: message.macroButtons })

					// Notify the webview about the updated macros
					sendMessage({
						type: "macroButtonsUpdated",
						macroButtons: message.macroButtons,
					})
				}
				return true
			}

			return false
		},
	}
}
