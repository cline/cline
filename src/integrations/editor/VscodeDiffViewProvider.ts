import { DIFF_VIEW_URI_SCHEME, DiffViewProvider } from "./DiffViewProvider"
import * as vscode from "vscode"
import * as path from "path"
import { getHostBridgeProvider } from "@/hosts/host-providers"
import { ShowTextDocumentOptions, ShowTextDocumentRequest } from "@/shared/proto/host/window"
import { arePathsEqual } from "@/utils/path"
import { DecorationController } from "./DecorationController"

export class VscodeDiffViewProvider extends DiffViewProvider {
	private activeDiffEditor?: vscode.TextEditor

	override async openDiffEditor(): Promise<void> {
		if (!this.relPath) {
			throw new Error("No file path set")
		}
		const uri = vscode.Uri.file(path.resolve(this.cwd, this.relPath))
		// If this diff editor is already open (ie if a previous write file was interrupted) then we should activate that instead of opening a new diff
		const diffTab = vscode.window.tabGroups.all
			.flatMap((group) => group.tabs)
			.find(
				(tab) =>
					tab.input instanceof vscode.TabInputTextDiff &&
					tab.input?.original?.scheme === DIFF_VIEW_URI_SCHEME &&
					arePathsEqual(tab.input.modified.fsPath, uri.fsPath),
			)
		if (diffTab && diffTab.input instanceof vscode.TabInputTextDiff) {
			const editorInfo = await getHostBridgeProvider().windowClient.showTextDocument(
				ShowTextDocumentRequest.create({
					path: diffTab.input.modified.fsPath,
					options: ShowTextDocumentOptions.create({
						preserveFocus: true,
					}),
				}),
			)
			// Find the editor that matches the returned path
			const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === editorInfo.documentPath)
			if (!editor) {
				throw new Error("Failed to find opened text editor")
			}
			this.activeDiffEditor = editor
		}

		if (!this.activeDiffEditor) {
			// Open new diff editor
			this.activeDiffEditor = await new Promise<vscode.TextEditor>((resolve, reject) => {
				const fileName = path.basename(uri.fsPath)
				const fileExists = this.editType === "modify"
				const disposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
					if (editor && arePathsEqual(editor.document.uri.fsPath, uri.fsPath)) {
						disposable.dispose()
						resolve(editor)
					}
				})
				vscode.commands.executeCommand(
					"vscode.diff",
					vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${fileName}`).with({
						query: Buffer.from(this.originalContent ?? "").toString("base64"),
					}),
					uri,
					`${fileName}: ${fileExists ? "Original ↔ Cline's Changes" : "New File"} (Editable)`,
					{
						preserveFocus: true,
					},
				)
				// This may happen on very slow machines ie project idx
				setTimeout(() => {
					disposable.dispose()
					reject(new Error("Failed to open diff editor, please try again..."))
				}, 10_000)
			})
		}
		this.fadedOverlayController = new DecorationController("fadedOverlay", this.activeDiffEditor)
		this.activeLineController = new DecorationController("activeLine", this.activeDiffEditor)
		// Apply faded overlay to all lines initially
		this.fadedOverlayController.addLines(0, this.activeDiffEditor.document.lineCount)
	}

	override setCursor(line: number, character: number): void {
		const diffEditor = this.activeDiffEditor
		const document = diffEditor?.document
		if (!diffEditor || !document) {
			throw new Error("User closed text editor, unable to edit file...")
		}

		// Place cursor at the beginning of the diff editor to keep it out of the way of the stream animation
		const position = new vscode.Position(line, character)
		diffEditor.selection = new vscode.Selection(position, position)
	}

	override _scrollDiffEditorToLine(line: number): void {
		if (!this.activeDiffEditor) {
			return
		}
		const scrollLine = line + 4
		this.activeDiffEditor.revealRange(new vscode.Range(scrollLine, 0, scrollLine, 0), vscode.TextEditorRevealType.InCenter)
	}

	override async revertDocument() {
		if (!this.relPath || !this.activeDiffEditor) {
			return
		}
		const absolutePath = path.resolve(this.cwd, this.relPath)
		const updatedDocument = this.activeDiffEditor.document
		const edit = new vscode.WorkspaceEdit()
		const fullRange = new vscode.Range(
			updatedDocument.positionAt(0),
			updatedDocument.positionAt(updatedDocument.getText().length),
		)
		edit.replace(updatedDocument.uri, fullRange, this.originalContent ?? "")
		// Apply the edit and save, since contents shouldn't have changed this won't show in local history unless of course the user made changes and saved during the edit
		await vscode.workspace.applyEdit(edit)
		await updatedDocument.save()

		console.log(`File ${absolutePath} has been reverted to its original content.`)
		if (this.documentWasOpen) {
			await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), {
				preview: false,
				preserveFocus: true,
			})
		}
	}
	override async replaceText(
		content: string,
		range: { startLine: number; startChar: number; endLine: number; endChar: number },
	) {
		const edit = new vscode.WorkspaceEdit()

		edit.replace(document.uri, rangeToReplace, content)
		await vscode.workspace.applyEdit(edit)

		// Update decorations for the entire changed section
		this.activeLineController.setActiveLine(currentLine)
		this.fadedOverlayController.updateOverlayAfterLine(currentLine, document.lineCount)
	}
}
