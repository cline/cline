import * as vscode from "vscode"
import { getHostBridgeProvider } from "@/hosts/host-providers"

/**
 * Shows a save dialog to the user via host bridge
 * @param options Save dialog options
 * @returns Promise resolving to the selected file URI or undefined if cancelled
 * @throws Error if the operation fails
 */
export async function showSaveDialog(options?: vscode.SaveDialogOptions): Promise<vscode.Uri | undefined> {
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
		return response.path ? vscode.Uri.file(response.path) : undefined
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to show save dialog: ${errorMessage}`)
	}
}
