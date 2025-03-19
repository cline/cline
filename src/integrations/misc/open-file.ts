import * as path from "path"
import * as os from "os"
import * as vscode from "vscode"
import { arePathsEqual } from "../../utils/path"
import { fileExistsAtPath } from "../../utils/fs"

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

export async function openFile(absolutePath: string | vscode.Uri) {
	try {
		let uri = absolutePath instanceof vscode.Uri ? absolutePath : vscode.Uri.parse(absolutePath)
		// Check if the document is already open in a tab group that's not in the active editor's column. If it is, then close it (if not dirty) so that we don't duplicate tabs
		try {
			for (const group of vscode.window.tabGroups.all) {
				const existingTab = group.tabs.find(
					(tab) => tab.input instanceof vscode.TabInputText && arePathsEqual(tab.input.uri.fsPath, uri.fsPath),
				)
				if (existingTab) {
					const activeColumn = vscode.window.activeTextEditor?.viewColumn
					const tabColumn = vscode.window.tabGroups.all.find((group) => group.tabs.includes(existingTab))?.viewColumn
					if (activeColumn && activeColumn !== tabColumn && !existingTab.isDirty) {
						await vscode.window.tabGroups.close(existingTab)
					}
					break
				}
			}
		} catch {} // not essential, sometimes tab operations fail

		if (!(await fileExistsAtPath(uri)) && typeof absolutePath === "string") {
			const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri).at(0)
			if (!cwd) {
				throw new Error("No workspace folder found.")
			}
			uri = vscode.Uri.joinPath(cwd, absolutePath)
		}
		const document = await vscode.workspace.openTextDocument(uri)
		await vscode.window.showTextDocument(document, { preview: false })
	} catch (error) {
		vscode.window.showErrorMessage(`Could not open file!`)
	}
}
