import * as vscode from "vscode"
import { getHostBridgeProvider } from "@/hosts/host-providers"

/**
 * Shows a save dialog to the user via host bridge
 * @param options Save dialog options
 * @returns Promise resolving to the selected file path
 * @throws Error if the operation fails or no file is selected
 */
export async function showSaveDialog(options?: vscode.SaveDialogOptions): Promise<string> {
	try {
		const filterMap: Record<string, any> = {}
		if (options?.filters) {
			for (const [key, value] of Object.entries(options.filters)) {
				filterMap[key] = { extensions: value }
			}
		}

		const response = await getHostBridgeProvider().windowClient.showSaveDialog({
			defaultPath: options?.defaultUri?.fsPath,
			filters: { filterMap },
			saveLabel: options?.saveLabel,
		})
		if (!response.path) {
			throw new Error("No file path selected")
		}
		return response.path
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to show save dialog: ${errorMessage}`)
	}
}
