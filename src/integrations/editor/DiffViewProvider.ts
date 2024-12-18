import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { createDirectoriesForFile } from "../../utils/fs"
import { arePathsEqual } from "../../utils/path"
import { formatResponse } from "../../core/prompts/responses"
import { DecorationController } from "./DecorationController"
import * as diff from "diff"
import { diagnosticsToProblemsString, getNewDiagnostics } from "../diagnostics"

export const DIFF_VIEW_URI_SCHEME = "cline-diff"

/**
 * Manages the VSCode diff view functionality for comparing and editing file changes.
 * This provider handles both creation of new files and modification of existing files,
 * with support for streaming updates, decoration overlays, and diagnostic tracking.
 */
export class DiffViewProvider {
	editType?: "create" | "modify"
	isEditing = false
	originalContent: string | undefined
	private createdDirs: string[] = []
	private documentWasOpen = false
	private relPath?: string
	private newContent?: string
	private activeDiffEditor?: vscode.TextEditor
	private fadedOverlayController?: DecorationController
	private activeLineController?: DecorationController
	private streamedLines: string[] = []
	private preDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = []
	private batchSize = 10
	private updateTimeout?: NodeJS.Timeout
	private scrollTimeout?: NodeJS.Timeout
	private updateMetrics = {
		lastUpdateTime: 0,
		updateCount: 0,
		totalUpdateTime: 0
	}

	/**
	 * Creates a new DiffViewProvider instance.
	 * @param cwd - The current working directory path
	 */
	constructor(private cwd: string) {}

	/**
	 * Opens a file in the diff view for editing.
	 * Creates necessary directories for new files and handles existing file content.
	 * @param relPath - The relative path to the file from the current working directory
	 * @throws Error if the diff editor cannot be opened
	 */
	async open(relPath: string): Promise<void> {
		this.relPath = relPath
		const fileExists = this.editType === "modify"
		const absolutePath = path.resolve(this.cwd, relPath)
		this.isEditing = true
		// if the file is already open, ensure it's not dirty before getting its contents
		if (fileExists) {
			const existingDocument = vscode.workspace.textDocuments.find((doc) =>
				arePathsEqual(doc.uri.fsPath, absolutePath),
			)
			if (existingDocument && existingDocument.isDirty) {
				await existingDocument.save()
			}
		}

		// get diagnostics before editing the file, we'll compare to diagnostics after editing to see if cline needs to fix anything
		this.preDiagnostics = vscode.languages.getDiagnostics()

		if (fileExists) {
			this.originalContent = await fs.readFile(absolutePath, "utf-8")
		} else {
			this.originalContent = ""
		}
		// for new files, create any necessary directories and keep track of new directories to delete if the user denies the operation
		this.createdDirs = await createDirectoriesForFile(absolutePath)
		// make sure the file exists before we open it
		if (!fileExists) {
			await fs.writeFile(absolutePath, "")
		}
		// if the file was already open, close it (must happen after showing the diff view since if it's the only tab the column will close)
		this.documentWasOpen = false
		// close the tab if it's open (it's already saved above)
		const tabs = vscode.window.tabGroups.all
			.map((tg) => tg.tabs)
			.flat()
			.filter(
				(tab) => tab.input instanceof vscode.TabInputText && arePathsEqual(tab.input.uri.fsPath, absolutePath),
			)
		for (const tab of tabs) {
			if (!tab.isDirty) {
				await vscode.window.tabGroups.close(tab)
			}
			this.documentWasOpen = true
		}
		this.activeDiffEditor = await this.openDiffEditor()
		this.fadedOverlayController = new DecorationController("fadedOverlay", this.activeDiffEditor)
		this.activeLineController = new DecorationController("activeLine", this.activeDiffEditor)
		// Apply faded overlay to all lines initially
		this.fadedOverlayController.addLines(0, this.activeDiffEditor.document.lineCount)
		this.scrollEditorToLine(0) // will this crash for new files?
		this.streamedLines = []
	}

	/**
	 * Updates the diff view with new content, handling the changes in batches for performance.
	 * @param accumulatedContent - The complete content up to this point
	 * @param isFinal - Whether this is the final update
	 * @throws Error if required values are not set or editor is closed
	 */
	async update(accumulatedContent: string, isFinal: boolean) {
		if (!this.relPath || !this.activeLineController || !this.fadedOverlayController) {
			throw new Error("Required values not set")
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

		// Place cursor at beginning
		const beginningOfDocument = new vscode.Position(0, 0)
		diffEditor.selection = new vscode.Selection(beginningOfDocument, beginningOfDocument)

		// Optimize batch size based on content length
		this.batchSize = this.calculateOptimalBatchSize(diffLines.length)

		// Batch process lines
		for (let i = 0; i < diffLines.length; i += this.batchSize) {
			const start = performance.now()
			const batchLines = diffLines.slice(i, i + this.batchSize)
			const currentLine = this.streamedLines.length + i

			// Apply batch edit
			const edit = new vscode.WorkspaceEdit()
			const rangeToReplace = new vscode.Range(0, 0, currentLine + batchLines.length, 0)
			const contentToReplace = [...accumulatedLines.slice(0, currentLine), ...batchLines].join("\n") + "\n"
			edit.replace(document.uri, rangeToReplace, contentToReplace)
			await vscode.workspace.applyEdit(edit)

			// Debounce decoration updates
			if (this.updateTimeout) {
				clearTimeout(this.updateTimeout)
			}
			this.updateTimeout = setTimeout(() => {
				// Update decorations for the batch
				this.activeLineController?.setActiveLine(currentLine + batchLines.length - 1)
				this.fadedOverlayController?.updateOverlayAfterLine(
					currentLine + batchLines.length - 1,
					document.lineCount
				)
				// Scroll to current line with debounce
				if (this.scrollTimeout) {
					clearTimeout(this.scrollTimeout)
				}
				this.scrollTimeout = setTimeout(() => {
					this.scrollEditorToLine(currentLine + batchLines.length - 1)
				}, 32)
			}, 32)

			// Update streamedLines for this batch
			this.streamedLines = [...this.streamedLines, ...batchLines]

			// Update metrics
			const duration = performance.now() - start
			this.updateMetrics.updateCount++
			this.updateMetrics.totalUpdateTime += duration
			
			// Adjust batch size periodically
			if (this.updateMetrics.updateCount % 10 === 0) {
				const avgUpdateTime = this.updateMetrics.totalUpdateTime / this.updateMetrics.updateCount
				this.batchSize = this.adjustBatchSize(avgUpdateTime)
			}
		}

		if (isFinal) {
			// Clear timeouts
			if (this.updateTimeout) {
				clearTimeout(this.updateTimeout)
			}
			if (this.scrollTimeout) {
				clearTimeout(this.scrollTimeout)
			}

			// Handle remaining lines if content is shorter
			if (this.streamedLines.length < document.lineCount) {
				const edit = new vscode.WorkspaceEdit()
				edit.delete(
					document.uri,
					new vscode.Range(this.streamedLines.length, 0, document.lineCount, 0)
				)
				await vscode.workspace.applyEdit(edit)
			}

			// Add final newline if needed
			const hasEmptyLastLine = this.originalContent?.endsWith("\n")
			if (hasEmptyLastLine && !accumulatedContent.endsWith("\n")) {
				accumulatedContent += "\n"
			}

			// Clear decorations
			this.fadedOverlayController.clear()
			this.activeLineController.clear()
		}
	}

	/**
	 * Saves the changes made in the diff view and handles any new diagnostics.
	 * @returns Object containing new problems message, user edits, and final content
	 */
	async saveChanges(): Promise<{
		newProblemsMessage: string | undefined
		userEdits: string | undefined
		finalContent: string | undefined
	}> {
		if (!this.relPath || !this.newContent || !this.activeDiffEditor) {
			return { newProblemsMessage: undefined, userEdits: undefined, finalContent: undefined }
		}
		const absolutePath = path.resolve(this.cwd, this.relPath)
		const updatedDocument = this.activeDiffEditor.document

		// get the contents before save operation which may do auto-formatting
		const preSaveContent = updatedDocument.getText()

		if (updatedDocument.isDirty) {
			await updatedDocument.save()
		}

		// await delay(100)
		// get text after save in case there is any auto-formatting done by the editor
		const postSaveContent = updatedDocument.getText()

		await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })
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
		const newProblems = diagnosticsToProblemsString(
			getNewDiagnostics(this.preDiagnostics, postDiagnostics),
			[
				vscode.DiagnosticSeverity.Error, // only including errors since warnings can be distracting (if user wants to fix warnings they can use the Workspace Problems (see below for diagnostics) mention)
			],
			this.cwd,
		) // will be empty string if no errors
		const newProblemsMessage =
			newProblems.length > 0 ? `\n\nNew problems detected after saving the file:\n${newProblems}` : ""

		// If the edited content has different EOL characters, we don't want to show a diff with all the EOL differences.
		const newContentEOL = this.newContent.includes("\r\n") ? "\r\n" : "\n"
		const normalizedPreSaveContent = preSaveContent.replace(/\r\n|\n/g, newContentEOL).trimEnd() + newContentEOL // trimEnd to fix issue where editor adds in extra new line automatically
		const normalizedPostSaveContent = postSaveContent.replace(/\r\n|\n/g, newContentEOL).trimEnd() + newContentEOL // this is the final content we return to the model to use as the new baseline for future edits
		// just in case the new content has a mix of varying EOL characters
		const normalizedNewContent = this.newContent.replace(/\r\n|\n/g, newContentEOL).trimEnd() + newContentEOL
		if (normalizedPreSaveContent !== normalizedNewContent) {
			// user made changes before approving edit. let the model know about user made changes (not including post-save auto-formatting changes)
			const userEdits = formatResponse.createPrettyPatch(
				this.relPath.toPosix(),
				normalizedNewContent,
				normalizedPreSaveContent,
			)
			return { newProblemsMessage, userEdits, finalContent: normalizedPostSaveContent }
		} else {
			// no changes to cline's edits
			return { newProblemsMessage, userEdits: undefined, finalContent: normalizedPostSaveContent }
		}
	}

	/**
	 * Reverts any changes made in the diff view and cleans up resources.
	 * For new files, this includes deleting the file and any created directories.
	 */
	async revertChanges(): Promise<void> {
		if (!this.relPath || !this.activeDiffEditor) {
			return
		}
		const fileExists = this.editType === "modify"
		const updatedDocument = this.activeDiffEditor.document
		const absolutePath = path.resolve(this.cwd, this.relPath)
		if (!fileExists) {
			if (updatedDocument.isDirty) {
				await updatedDocument.save()
			}
			await this.closeAllDiffViews()
			await fs.unlink(absolutePath)
			// Remove only the directories we created, in reverse order
			for (let i = this.createdDirs.length - 1; i >= 0; i--) {
				await fs.rmdir(this.createdDirs[i])
				console.log(`Directory ${this.createdDirs[i]} has been deleted.`)
			}
			console.log(`File ${absolutePath} has been deleted.`)
		} else {
			// revert document
			const edit = new vscode.WorkspaceEdit()
			const fullRange = new vscode.Range(
				updatedDocument.positionAt(0),
				updatedDocument.positionAt(updatedDocument.getText().length),
			)
			edit.replace(updatedDocument.uri, fullRange, this.originalContent ?? "")
			// Apply the edit and save, since contents shouldnt have changed this wont show in local history unless of course the user made changes and saved during the edit
			await vscode.workspace.applyEdit(edit)
			await updatedDocument.save()
			console.log(`File ${absolutePath} has been reverted to its original content.`)
			if (this.documentWasOpen) {
				await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), {
					preview: false,
				})
			}
			await this.closeAllDiffViews()
		}

		// edit is done
		await this.reset()
	}

	/**
	 * Closes all diff views in VSCode.
	 * Only closes tabs that aren't dirty to prevent data loss.
	 */
	private async closeAllDiffViews() {
		const tabs = vscode.window.tabGroups.all
			.flatMap((tg) => tg.tabs)
			.filter(
				(tab) =>
					tab.input instanceof vscode.TabInputTextDiff &&
					tab.input?.original?.scheme === DIFF_VIEW_URI_SCHEME,
			)
		for (const tab of tabs) {
			// trying to close dirty views results in save popup
			if (!tab.isDirty) {
				await vscode.window.tabGroups.close(tab)
			}
		}
	}

	/**
	 * Opens a new diff editor or activates an existing one.
	 * @returns Promise resolving to the active text editor
	 * @throws Error if the diff editor fails to open
	 */
	private async openDiffEditor(): Promise<vscode.TextEditor> {
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
			const editor = await vscode.window.showTextDocument(diffTab.input.modified)
			return editor
		}
		// Open new diff editor
		return new Promise<vscode.TextEditor>((resolve, reject) => {
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
			)
			// This may happen on very slow machines ie project idx
			setTimeout(() => {
				disposable.dispose()
				reject(new Error("Failed to open diff editor, please try again..."))
			}, 10_000)
		})
	}

	/**
	 * Scrolls the editor to reveal a specific line.
	 * @param line - The line number to scroll to
	 */
	private scrollEditorToLine(line: number) {
		if (this.activeDiffEditor) {
			const scrollLine = line + 4
			this.activeDiffEditor.revealRange(
				new vscode.Range(scrollLine, 0, scrollLine, 0),
				vscode.TextEditorRevealType.InCenter,
			)
		}
	}

	/**
	 * Calculates the optimal batch size based on total number of lines.
	 * @param totalLines - Total number of lines in the content
	 * @returns Optimal batch size for processing
	 */
	private calculateOptimalBatchSize(totalLines: number): number {
		if (totalLines < 100) return 5
		if (totalLines < 500) return 10
		if (totalLines < 1000) return 20
		return 50
	}

	/**
	 * Adjusts the batch size based on average update time for performance optimization.
	 * @param avgUpdateTime - Average time taken for updates in milliseconds
	 * @returns Adjusted batch size
	 */
	private adjustBatchSize(avgUpdateTime: number): number {
		if (avgUpdateTime > 100) return Math.max(5, this.batchSize / 2)
		if (avgUpdateTime < 16) return Math.min(50, this.batchSize * 1.5)
		return this.batchSize
	}

	/**
	 * Scrolls the editor to the first difference between original and current content.
	 */
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

	/**
	 * Resets the provider state and cleans up resources.
	 * This includes clearing timeouts and resetting all internal state variables.
	 */
	async reset() {
		if (this.updateTimeout) {
			clearTimeout(this.updateTimeout)
		}
		if (this.scrollTimeout) {
			clearTimeout(this.scrollTimeout)
		}
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
		this.updateMetrics = {
			lastUpdateTime: 0,
			updateCount: 0,
			totalUpdateTime: 0
		}
	}
}
