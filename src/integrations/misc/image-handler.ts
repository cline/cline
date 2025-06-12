import * as path from "path"
import * as os from "os"
import * as vscode from "vscode"
import { getWorkspacePath } from "../../utils/path"
import { t } from "../../i18n"

export async function openImage(dataUri: string, options?: { values?: { action?: string } }) {
	const matches = dataUri.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/)
	if (!matches) {
		vscode.window.showErrorMessage(t("common:errors.invalid_data_uri"))
		return
	}
	const [, format, base64Data] = matches
	const imageBuffer = Buffer.from(base64Data, "base64")

	// Default behavior: open the image
	const tempFilePath = path.join(os.tmpdir(), `temp_image_${Date.now()}.${format}`)
	try {
		await vscode.workspace.fs.writeFile(vscode.Uri.file(tempFilePath), imageBuffer)
		// Check if this is a copy action
		if (options?.values?.action === "copy") {
			try {
				// Read the image file
				const imageData = await vscode.workspace.fs.readFile(vscode.Uri.file(tempFilePath))

				// Convert to base64 for clipboard
				const base64Image = Buffer.from(imageData).toString("base64")
				const dataUri = `data:image/${format};base64,${base64Image}`

				// Use vscode.env.clipboard to copy the data URI
				// Note: VSCode doesn't support copying binary image data directly to clipboard
				// So we copy the data URI which can be pasted in many applications
				await vscode.env.clipboard.writeText(dataUri)

				vscode.window.showInformationMessage(t("common:info.image_copied_to_clipboard"))
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				vscode.window.showErrorMessage(t("common:errors.error_copying_image", { errorMessage }))
			} finally {
				// Clean up temp file
				try {
					await vscode.workspace.fs.delete(vscode.Uri.file(tempFilePath))
				} catch {
					// Ignore cleanup errors
				}
			}
			return
		}
		await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(tempFilePath))
	} catch (error) {
		vscode.window.showErrorMessage(t("common:errors.error_opening_image", { error }))
	}
}

export async function saveImage(dataUri: string) {
	const matches = dataUri.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/)
	if (!matches) {
		vscode.window.showErrorMessage(t("common:errors.invalid_data_uri"))
		return
	}
	const [, format, base64Data] = matches
	const imageBuffer = Buffer.from(base64Data, "base64")

	// Get workspace path or fallback to home directory
	const workspacePath = getWorkspacePath()
	const defaultPath = workspacePath || os.homedir()
	const defaultFileName = `mermaid_diagram_${Date.now()}.${format}`
	const defaultUri = vscode.Uri.file(path.join(defaultPath, defaultFileName))

	// Show save dialog
	const saveUri = await vscode.window.showSaveDialog({
		filters: {
			Images: [format],
			"All Files": ["*"],
		},
		defaultUri: defaultUri,
	})

	if (!saveUri) {
		// User cancelled the save dialog
		return
	}

	try {
		// Write the image to the selected location
		await vscode.workspace.fs.writeFile(saveUri, imageBuffer)
		vscode.window.showInformationMessage(t("common:info.image_saved", { path: saveUri.fsPath }))
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		vscode.window.showErrorMessage(t("common:errors.error_saving_image", { errorMessage }))
	}
}
