import * as vscode from "vscode"
import { Controller } from "../core/controller" // Adjust the path based on your project structure

/**
 * Registers the 'cline.addFileToChat' command.
 * This command adds a file mention (@/path/to/file) to the Cline chat input
 * when triggered from the explorer or editor tab context menu.
 *
 * @param context The extension context.
 * @param controller The Cline controller instance.
 * @returns A disposable representing the registered command.
 */
export function registerAddFileToChatCommand(context: vscode.ExtensionContext, controller: Controller): vscode.Disposable {
	const commandDisposable = vscode.commands.registerCommand(
		"cline.addFileToChat",
		// VS Code passes the URI of the item right-clicked (clickedUri)
		// and an array of all selected URIs (selectedUris) for explorer context menus
		async (clickedUri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
			let potentialUris: vscode.Uri[] = []

			// 1. Handle Explorer multi-select explicitly
			if (Array.isArray(selectedUris) && selectedUris.length > 0) {
				potentialUris = selectedUris
			} else {
				// 2. Not explorer multi-select: Assume tab context, explorer single-select, or palette.
				// Prioritize getting all tabs from the active group first.
				const activeTabGroup = vscode.window.tabGroups.activeTabGroup
				if (activeTabGroup) {
					activeTabGroup.tabs.forEach((tab) => {
						// Only consider tabs representing saved files
						if (tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === "file") {
							potentialUris.push(tab.input.uri)
						}
					})
				}

				// 3. If no tabs were found (or no active group), fall back
				if (potentialUris.length === 0) {
					// Use the clicked URI if available (covers explorer single-select)
					if (clickedUri && clickedUri.scheme === "file") {
						potentialUris.push(clickedUri)
					} else {
						// Final fallback: active editor (covers command palette)
						const activeEditor = vscode.window.activeTextEditor
						if (activeEditor && activeEditor.document.uri.scheme === "file") {
							potentialUris.push(activeEditor.document.uri)
						}
					}
				}
				// If invoked from tab context menu, clickedUri might be among the active tabs.
				// Deduplication later will handle this.
			}

			// 4. Filter for 'file' scheme (redundant but safe) and deduplicate
			const urisToProcess = [
				...new Set( // Use Set for easy deduplication
					potentialUris
						.filter((uri) => uri.scheme === "file") // Ensure it's a file URI
						.map((uri) => uri.toString()), // Convert to string for Set comparison
				),
			].map((uriString) => vscode.Uri.parse(uriString)) // Convert back to Uri objects

			if (urisToProcess.length === 0) {
				vscode.window.showWarningMessage("Cline: No valid files found to add.")
				return
			}

			// 5. Generate mentions
			const fileMentions = urisToProcess
				.map((uri) => {
					const filePath = uri.fsPath
					if (!filePath) {
						console.warn("Cline: Could not determine file path for URI:", uri.toString())
						return null // Skip if path is invalid
					}
					// Use the controller's helper method synchronously if possible, or adjust if it needs to be async
					// Assuming getFileMentionFromPath is synchronous based on previous code
					return controller.getFileMentionFromPath(filePath)
				})
				.filter((mention) => mention !== null) // Remove any nulls from failed path resolutions
				.join(" ") // Join mentions with a space

			if (!fileMentions) {
				vscode.window.showWarningMessage("Cline: Could not generate mentions for the selected file(s).")
				return
			}

			try {
				// Call the controller method to add the combined mentions string
				// Rename this method in the controller as well
				await controller.addTextToChatInput(fileMentions)
			} catch (error) {
				vscode.window.showErrorMessage(
					`Cline: Error adding file(s) to chat: ${error instanceof Error ? error.message : String(error)}`,
				)
				console.error("Error in cline.addFileToChat command:", error)
			}
		},
	)

	context.subscriptions.push(commandDisposable)
	return commandDisposable
}
