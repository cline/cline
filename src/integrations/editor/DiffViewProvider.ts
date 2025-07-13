import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { createDirectoriesForFile } from "@utils/fs"
import { arePathsEqual, getCwd } from "@utils/path"
import { formatResponse } from "@core/prompts/responses"
import { DecorationController } from "./DecorationController"
import * as diff from "diff"
import { diagnosticsToProblemsString, getNewDiagnostics } from "../diagnostics"
import { detectEncoding } from "../misc/extract-text"
import * as iconv from "iconv-lite"
import { getHostBridgeProvider } from "@/hosts/host-providers"
import { ShowTextDocumentRequest, ShowTextDocumentOptions } from "@/shared/proto/host/window"

export const DIFF_VIEW_URI_SCHEME = "cline-diff"

export abstract class DiffViewProvider {
	editType?: "create" | "modify"
	isEditing = false
	originalContent: string | undefined
	private createdDirs: string[] = []
	protected documentWasOpen = false
	protected relPath?: string
	protected absolutePath?: string
	protected fileEncoding: string = "utf8"
	private streamedLines: string[] = []
	private newContent?: string

	protected activeDiffEditor?: vscode.TextEditor
	protected fadedOverlayController?: DecorationController
	protected activeLineController?: DecorationController
	protected preDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = []

	constructor() {}

	public async open(relPath: string): Promise<void> {
		this.isEditing = true
		this.relPath = relPath
		this.absolutePath = path.resolve(await getCwd(), relPath)
		const fileExists = this.editType === "modify"

		// if the file is already open, ensure it's not dirty before getting its contents
		if (fileExists) {
			const existingDocument = vscode.workspace.textDocuments.find((doc) =>
				arePathsEqual(doc.uri.fsPath, this.absolutePath),
			)
			if (existingDocument && existingDocument.isDirty) {
				await existingDocument.save()
			}

			const fileBuffer = await fs.readFile(this.absolutePath)
			this.fileEncoding = await detectEncoding(fileBuffer)
			this.originalContent = iconv.decode(fileBuffer, this.fileEncoding)
		} else {
			this.originalContent = ""
			this.fileEncoding = "utf8"
		}
		// for new files, create any necessary directories and keep track of new directories to delete if the user denies the operation
		this.createdDirs = await createDirectoriesForFile(this.absolutePath)
		// make sure the file exists before we open it
		if (!fileExists) {
			await fs.writeFile(this.absolutePath, "")
		}
		await this.openDiffEditor()
		this.scrollEditorToLine(0) // will this crash for new files?
		this.streamedLines = []
	}

	/**
	 * Opens a diff editor or viewer for the current file.
	 *
	 * This abstract method must be implemented by subclasses to create and display
	 * a diff editor or viewer that shows the difference between the original and
	 * modified content.
	 *
	 * Called automatically by the `open` method after ensuring the file exists and
	 * creating any necessary directories.
	 *
	 * @returns A promise that resolves when the diff editor is open and ready
	 */
	protected abstract openDiffEditor(): Promise<void>

	async update(
		accumulatedContent: string,
		isFinal: boolean,
		changeLocation?: { startLine: number; endLine: number; startChar: number; endChar: number },
	) {
		if (!this.relPath || !this.activeLineController || !this.fadedOverlayController) {
			throw new Error("Required values not set")
		}

		// --- Fix to prevent duplicate BOM ---
		// Strip potential BOM from incoming content. VS Code's `applyEdit` might implicitly handle the BOM
		// when replacing from the start (0,0), and we want to avoid duplication.
		// Final BOM is handled in `saveChanges`.
		if (accumulatedContent.startsWith("\ufeff")) {
			accumulatedContent = accumulatedContent.slice(1) // Remove the BOM character
		}

		this.newContent = accumulatedContent
		const accumulatedLines = accumulatedContent.split("\n")
		if (!isFinal) {
			accumulatedLines.pop() // remove the last partial line only if it's not the final update
		}
		const diffLines = accumulatedLines.slice(this.streamedLines.length)

		const diffEditor = this.activeDiffEditor
		const document = diffEditor?.document
		if (!diffEditor || !document) {
			throw new Error("User closed text editor, unable to edit file...")
		}

		// Place cursor at the beginning of the diff editor to keep it out of the way of the stream animation
		const beginningOfDocument = new vscode.Position(0, 0)
		diffEditor.selection = new vscode.Selection(beginningOfDocument, beginningOfDocument)

		// Instead of animating each line, we'll update in larger chunks
		const currentLine = this.streamedLines.length + diffLines.length - 1
		if (currentLine >= 0) {
			// Only proceed if we have new lines

			// Replace all content up to the current line with accumulated lines
			// This is necessary (as compared to inserting one line at a time) to handle cases where html tags on previous lines are auto closed for example
			const contentToReplace = accumulatedLines.slice(0, currentLine + 1).join("\n") + "\n"
			const rangeToReplace = { startLine: 0, endLine: currentLine + 1 }
			await this.replaceText(contentToReplace, rangeToReplace, currentLine)

			// Scroll to the actual change location if provided.
			if (changeLocation) {
				// We have the actual location of the change, scroll to it
				const targetLine = changeLocation.startLine
				this.scrollEditorToLine(targetLine)
			} else {
				// Fallback to the old logic for non-replacement updates
				if (diffLines.length <= 5) {
					// For small changes, just jump directly to the line
					this.scrollEditorToLine(currentLine)
				} else {
					// For larger changes, create a quick scrolling animation
					const startLine = this.streamedLines.length
					const endLine = currentLine
					const totalLines = endLine - startLine
					const numSteps = 10 // Adjust this number to control animation speed
					const stepSize = Math.max(1, Math.floor(totalLines / numSteps))

					// Create and await the smooth scrolling animation
					for (let line = startLine; line <= endLine; line += stepSize) {
						this.activeDiffEditor?.revealRange(
							new vscode.Range(line, 0, line, 0),
							vscode.TextEditorRevealType.InCenter,
						)
						await new Promise((resolve) => setTimeout(resolve, 16)) // ~60fps
					}
					// Ensure we end at the final line
					this.scrollEditorToLine(currentLine)
				}
			}
		}

		// Update the streamedLines with the new accumulated content
		this.streamedLines = accumulatedLines
		if (isFinal) {
			// Handle any remaining lines if the new content is shorter than the original
			if (this.streamedLines.length < document.lineCount) {
				const edit = new vscode.WorkspaceEdit()
				edit.delete(document.uri, new vscode.Range(this.streamedLines.length, 0, document.lineCount, 0))
				await vscode.workspace.applyEdit(edit)
			}
			// Add empty last line if original content had one
			const hasEmptyLastLine = this.originalContent?.endsWith("\n")
			if (hasEmptyLastLine) {
				const accumulatedLines = accumulatedContent.split("\n")
				if (accumulatedLines[accumulatedLines.length - 1] !== "") {
					accumulatedContent += "\n"
				}
			}
			// Clear all decorations at the end (before applying final edit)
			this.fadedOverlayController.clear()
			this.activeLineController.clear()
		}
	}

	/**
	 * Replaces text in the diff editor with the specified content.
	 *
	 * This abstract method must be implemented by subclasses to handle the actual
	 * text replacement in their specific diff editor implementation. It's called
	 * during the streaming update process to progressively show changes.
	 *
	 * @param content The new content to insert into the document
	 * @param rangeToReplace An object specifying the line range to replace
	 * @param currentLine The current line number being edited, used for scroll positioning
	 * @returns A promise that resolves when the text replacement is complete
	 */
	abstract replaceText(
		content: string,
		rangeToReplace: { startLine: number; endLine: number },
		currentLine: number,
	): Promise<void>

	async saveChanges(): Promise<{
		newProblemsMessage: string | undefined
		userEdits: string | undefined
		autoFormattingEdits: string | undefined
		finalContent: string | undefined
	}> {
		if (!this.relPath || !this.newContent || !this.activeDiffEditor) {
			return {
				newProblemsMessage: undefined,
				userEdits: undefined,
				autoFormattingEdits: undefined,
				finalContent: undefined,
			}
		}
		const updatedDocument = this.activeDiffEditor.document

		// get the contents before save operation which may do auto-formatting
		const preSaveContent = updatedDocument.getText()

		if (updatedDocument.isDirty) {
			await updatedDocument.save()
		}

		// get text after save in case there is any auto-formatting done by the editor
		const postSaveContent = updatedDocument.getText()

		await getHostBridgeProvider().windowClient.showTextDocument(
			ShowTextDocumentRequest.create({
				path: this.absolutePath,
				options: ShowTextDocumentOptions.create({
					preview: false,
					preserveFocus: true,
				}),
			}),
		)
		await this.closeAllDiffViews()

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
		const postDiagnostics = vscode.languages.getDiagnostics()
		const newProblems = await diagnosticsToProblemsString(getNewDiagnostics(this.preDiagnostics, postDiagnostics), [
			vscode.DiagnosticSeverity.Error, // only including errors since warnings can be distracting (if user wants to fix warnings they can use the @problems mention)
		]) // will be empty string if no errors
		const newProblemsMessage =
			newProblems.length > 0 ? `\n\nNew problems detected after saving the file:\n${newProblems}` : ""

		// If the edited content has different EOL characters, we don't want to show a diff with all the EOL differences.
		const newContentEOL = this.newContent.includes("\r\n") ? "\r\n" : "\n"
		const normalizedPreSaveContent = preSaveContent.replace(/\r\n|\n/g, newContentEOL).trimEnd() + newContentEOL // trimEnd to fix issue where editor adds in extra new line automatically
		const normalizedPostSaveContent = postSaveContent.replace(/\r\n|\n/g, newContentEOL).trimEnd() + newContentEOL // this is the final content we return to the model to use as the new baseline for future edits
		// just in case the new content has a mix of varying EOL characters
		const normalizedNewContent = this.newContent.replace(/\r\n|\n/g, newContentEOL).trimEnd() + newContentEOL

		let userEdits: string | undefined
		if (normalizedPreSaveContent !== normalizedNewContent) {
			// user made changes before approving edit. let the model know about user made changes (not including post-save auto-formatting changes)
			userEdits = formatResponse.createPrettyPatch(this.relPath.toPosix(), normalizedNewContent, normalizedPreSaveContent)
			// return { newProblemsMessage, userEdits, finalContent: normalizedPostSaveContent }
		} else {
			// no changes to cline's edits
			// return { newProblemsMessage, userEdits: undefined, finalContent: normalizedPostSaveContent }
		}

		let autoFormattingEdits: string | undefined
		if (normalizedPreSaveContent !== normalizedPostSaveContent) {
			// auto-formatting was done by the editor
			autoFormattingEdits = formatResponse.createPrettyPatch(
				this.relPath.toPosix(),
				normalizedPreSaveContent,
				normalizedPostSaveContent,
			)
		}

		return {
			newProblemsMessage,
			userEdits,
			autoFormattingEdits,
			finalContent: normalizedPostSaveContent,
		}
	}

	async revertChanges(): Promise<void> {
		if (!this.absolutePath || !this.activeDiffEditor) {
			return
		}
		const fileExists = this.editType === "modify"
		const updatedDocument = this.activeDiffEditor.document
		if (!fileExists) {
			if (updatedDocument.isDirty) {
				await updatedDocument.save()
			}
			await this.closeAllDiffViews()
			await fs.unlink(this.absolutePath)
			// Remove only the directories we created, in reverse order
			for (let i = this.createdDirs.length - 1; i >= 0; i--) {
				await fs.rmdir(this.createdDirs[i])
				console.log(`Directory ${this.createdDirs[i]} has been deleted.`)
			}
			console.log(`File ${this.absolutePath} has been deleted.`)
		} else {
			// revert document
			const edit = new vscode.WorkspaceEdit()
			const fullRange = new vscode.Range(
				updatedDocument.positionAt(0),
				updatedDocument.positionAt(updatedDocument.getText().length),
			)
			edit.replace(updatedDocument.uri, fullRange, this.originalContent ?? "")
			// Apply the edit and save, since contents shouldn't have changed this won't show in local history unless of course the user made changes and saved during the edit
			await vscode.workspace.applyEdit(edit)
			await updatedDocument.save()
			console.log(`File ${this.absolutePath} has been reverted to its original content.`)
			if (this.documentWasOpen) {
				await getHostBridgeProvider().windowClient.showTextDocument(
					ShowTextDocumentRequest.create({
						path: this.absolutePath,
						options: ShowTextDocumentOptions.create({
							preview: false,
							preserveFocus: true,
						}),
					}),
				)
			}
			await this.closeAllDiffViews()
		}

		// edit is done
		await this.reset()
	}

	private async closeAllDiffViews() {
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

	private scrollEditorToLine(line: number) {
		if (this.activeDiffEditor) {
			const scrollLine = line + 4
			this.activeDiffEditor.revealRange(
				new vscode.Range(scrollLine, 0, scrollLine, 0),
				vscode.TextEditorRevealType.InCenter,
			)
		}
	}

	scrollToFirstDiff() {
		if (!this.activeDiffEditor) {
			return
		}
		const currentContent = this.activeDiffEditor.document.getText()
		const diffs = diff.diffLines(this.originalContent || "", currentContent)
		let lineCount = 0
		for (const part of diffs) {
			if (part.added || part.removed) {
				// Found the first diff, scroll to it
				this.activeDiffEditor.revealRange(
					new vscode.Range(lineCount, 0, lineCount, 0),
					vscode.TextEditorRevealType.InCenter,
				)
				return
			}
			if (!part.removed) {
				lineCount += part.count || 0
			}
		}
	}

	// close editor if open?
	async reset() {
		this.editType = undefined
		this.isEditing = false
		this.originalContent = undefined
		this.createdDirs = []
		this.documentWasOpen = false
		this.activeDiffEditor = undefined
		this.fadedOverlayController = undefined
		this.activeLineController = undefined
		this.streamedLines = []
		this.preDiagnostics = []
	}
}
