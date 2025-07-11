import { DIFF_VIEW_URI_SCHEME, DiffViewProvider } from "./DiffViewProvider"
import * as vscode from "vscode"
import * as path from "path"
import { getHostBridgeProvider } from "@/hosts/host-providers"
import { ShowTextDocumentOptions, ShowTextDocumentRequest } from "@/shared/proto/host/window"
import { arePathsEqual, getCwd } from "@/utils/path"
import { DecorationController } from "./DecorationController"
import { diagnosticsToProblemsString, getNewDiagnostics } from "../diagnostics"

export class VscodeDiffViewProvider extends DiffViewProvider {
	private activeDiffEditor?: vscode.TextEditor
	private fadedOverlayController?: DecorationController
	private activeLineController?: DecorationController
	private preDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = []

	override async openDiffEditor(): Promise<void> {
		if (!this.relPath || !this.absolutePath) {
			throw new Error("No file path set")
		}
		// get diagnostics before editing the file, we'll compare to diagnostics after editing to see if cline needs to fix anything
		this.preDiagnostics = vscode.languages.getDiagnostics()

		// if the file was already open, close it (must happen after showing the diff view since if it's the only tab the column will close)
		this.documentWasOpen = false
		// close the tab if it's open (it's been saved already)
		const uri = vscode.Uri.file(this.absolutePath)
		const tabs = vscode.window.tabGroups.all
			.map((tg) => tg.tabs)
			.flat()
			.filter((tab) => tab.input instanceof vscode.TabInputText && arePathsEqual(tab.input.uri.fsPath, this.absolutePath))
		for (const tab of tabs) {
			if (!tab.isDirty) {
				await vscode.window.tabGroups.close(tab)
			}
			this.documentWasOpen = true
		}

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

	/*
            Getting diagnostics before and after the file edit is a better approach than
            automatically tracking problems in real-time. This method ensures we only
            report new problems that are a direct result of this specific edit.
            Since these are new problems resulting from Cline's edit, we know they're
            directly related to the work he's doing. This eliminates the risk of Cline
            going off-task or getting distracted by unrelated issues, which was a problem
            with the previous auto-debug approach. Some users' machines may be slow to
            update diagnostics, so this approach provides a good balance between automation
            and avoiding potential issues where Cline might get stuck in loops due to
            outdated problem information. If no new problems show up by the time the user
            accepts the changes, they can always debug later using the '@problems' mention.
            This way, Cline only becomes aware of new problems resulting from his edits
            and can address them accordingly. If problems don't change immediately after
            applying a fix, Cline won't be notified, which is generally fine since the
            initial fix is usually correct and it may just take time for linters to catch up.
            */
	override async getNewDiagnosticProblems(): Promise<string> {
		const postDiagnostics = vscode.languages.getDiagnostics()
		return diagnosticsToProblemsString(
			getNewDiagnostics(this.preDiagnostics, postDiagnostics),
			[
				vscode.DiagnosticSeverity.Error, // only including errors since warnings can be distracting (if user wants to fix warnings they can use the @problems mention)
			],
			await getCwd(),
		) // will be empty string if no errors
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

	override scrollToLine(line: number): void {
		if (!this.activeDiffEditor) {
			return
		}
		const scrollLine = line + 4
		this.activeDiffEditor.revealRange(new vscode.Range(scrollLine, 0, scrollLine, 0), vscode.TextEditorRevealType.InCenter)
	}

	override async revertDocument() {
		if (!this.activeDiffEditor) {
			return
		}
		const document = this.activeDiffEditor.document
		const edit = new vscode.WorkspaceEdit()
		const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length))
		edit.replace(document.uri, fullRange, this.originalContent ?? "")
		// Apply the edit and save, since contents shouldn't have changed this won't show in local history unless of course the user made changes and saved during the edit
		await vscode.workspace.applyEdit(edit)
		await this.saveDocument()
	}
	override async replaceText(content: string, range: { startLine: number; endLine: number }, currentLine: number) {
		const diffEditor = this.activeDiffEditor
		const document = diffEditor?.document
		if (!diffEditor || !document) {
			throw new Error("User closed text editor, unable to edit file...")
		}

		// Replace all content up to the current line with accumulated lines
		// This is necessary (as compared to inserting one line at a time) to handle cases where html tags on previous lines are auto closed for example
		const edit = new vscode.WorkspaceEdit()

		const rangeToReplace = new vscode.Range(range.startLine, 0, range.endLine, 0)
		edit.replace(document.uri, rangeToReplace, content)
		await vscode.workspace.applyEdit(edit)

		// Update decorations for the entire changed section
		this.activeLineController?.setActiveLine(currentLine)
		this.fadedOverlayController?.updateOverlayAfterLine(currentLine, document.lineCount)
	}

	override async scrollAnimation(startLine: number, endLine: number): Promise<void> {
		const totalLines = endLine - startLine
		const numSteps = 10 // Adjust this number to control animation speed
		const stepSize = Math.max(1, Math.floor(totalLines / numSteps))

		// Create and await the smooth scrolling animation
		for (let line = startLine; line <= endLine; line += stepSize) {
			this.activeDiffEditor?.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter)
			await new Promise((resolve) => setTimeout(resolve, 16)) // ~60fps
		}
	}

	override async getDocumentText(): Promise<string | undefined> {
		return this.activeDiffEditor?.document.getText()
	}

	override async saveDocument(): Promise<void> {
		if (!this.activeDiffEditor) {
			return
		}
		if (this.activeDiffEditor.document.isDirty) {
			await this.activeDiffEditor.document.save()
		}
	}

	override async closeAllDiffViews() {
		const tabs = vscode.window.tabGroups.all
			.flatMap((tg) => tg.tabs)
			.filter((tab) => tab.input instanceof vscode.TabInputTextDiff && tab.input?.original?.scheme === DIFF_VIEW_URI_SCHEME)
		for (const tab of tabs) {
			// trying to close dirty views results in save popup
			if (!tab.isDirty) {
				await vscode.window.tabGroups.close(tab)
			}
		}
	}

	override async truncateDocument(lineNumber: number): Promise<void> {
		if (!this.activeDiffEditor) {
			return
		}
		const document = this.activeDiffEditor.document
		if (lineNumber < document.lineCount) {
			const edit = new vscode.WorkspaceEdit()
			edit.delete(document.uri, new vscode.Range(lineNumber, 0, document.lineCount, 0))
			await vscode.workspace.applyEdit(edit)
		}
		// Clear all decorations at the end (before applying final edit)
		this.fadedOverlayController?.clear()
		this.activeLineController?.clear()
	}

	override async resetDiffView(): Promise<void> {
		this.activeDiffEditor = undefined
		this.fadedOverlayController = undefined
		this.activeLineController = undefined
		this.preDiagnostics = []
	}
}
