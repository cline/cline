import * as path from "path"
import * as os from "os"
import * as vscode from "vscode"
import { arePathsEqual, getWorkspacePath } from "../../utils/path"

export async function openImage(dataUri: string) {
	const matches = dataUri.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/)
	if (!matches) {
		vscode.window.showErrorMessage("Invalid data URI format")
		return
	}
	const [, format, base64Data] = matches
	const imageBuffer = Buffer.from(base64Data, "base64")
	const tempFilePath = path.join(os.tmpdir(), `temp_image_${Date.now()}.${format}`)
	try {
		await vscode.workspace.fs.writeFile(vscode.Uri.file(tempFilePath), imageBuffer)
		await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(tempFilePath))
	} catch (error) {
		vscode.window.showErrorMessage(`Error opening image: ${error}`)
	}
}

interface OpenFileOptions {
	create?: boolean
	content?: string
	line?: number
}

export async function openFile(filePath: string, options: OpenFileOptions = {}) {
	try {
		// Get workspace root
		const workspaceRoot = getWorkspacePath()

		// If path starts with ./, resolve it relative to workspace root if available
		// Otherwise, use the path as provided without modification
		const fullPath = filePath.startsWith("./")
			? workspaceRoot
				? path.join(workspaceRoot, filePath.slice(2))
				: filePath
			: filePath

		const uri = vscode.Uri.file(fullPath)

		// Check if file exists
		try {
			await vscode.workspace.fs.stat(uri)
		} catch {
			// File doesn't exist
			if (!options.create) {
				throw new Error("File does not exist")
			}

			// Create with provided content or empty string
			const content = options.content || ""
			await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"))
		}

		// Check if the document is already open in a tab group that's not in the active editor's column
		try {
			for (const group of vscode.window.tabGroups.all) {
				const existingTab = group.tabs.find(
					(tab) =>
						tab.input instanceof vscode.TabInputText && arePathsEqual(tab.input.uri.fsPath, uri.fsPath),
				)
				if (existingTab) {
					const activeColumn = vscode.window.activeTextEditor?.viewColumn
					const tabColumn = vscode.window.tabGroups.all.find((group) =>
						group.tabs.includes(existingTab),
					)?.viewColumn
					if (activeColumn && activeColumn !== tabColumn && !existingTab.isDirty) {
						await vscode.window.tabGroups.close(existingTab)
					}
					break
				}
			}
		} catch {} // not essential, sometimes tab operations fail

		const document = await vscode.workspace.openTextDocument(uri)
		const selection =
			options.line !== undefined
				? new vscode.Selection(Math.max(options.line - 1, 0), 0, Math.max(options.line - 1, 0), 0)
				: undefined
		await vscode.window.showTextDocument(document, {
			preview: false,
			selection,
		})
	} catch (error) {
		if (error instanceof Error) {
			vscode.window.showErrorMessage(`Could not open file: ${error.message}`)
		} else {
			vscode.window.showErrorMessage(`Could not open file!`)
		}
	}
}
