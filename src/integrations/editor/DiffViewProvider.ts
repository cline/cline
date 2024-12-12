import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { createDirectoriesForFile } from "../../utils/fs"
import { arePathsEqual } from "../../utils/path"
import { formatResponse } from "../../core/prompts/responses"
import { DecorationController } from "./DecorationController"
import * as diff from "diff"
import { diagnosticsToProblemsString, getNewDiagnostics } from "../diagnostics"
import { CodeMerger } from "../../core/code-merger/CodeMerger"

export const DIFF_VIEW_URI_SCHEME = "cline-diff"

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
	private accumulatedSearchReplaceContent: string = ""

	constructor(private cwd: string) {}

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
		this.accumulatedSearchReplaceContent = ""
	}

	async update(accumulatedContent: string, isFinal: boolean) {
		if (!this.relPath || !this.activeLineController || !this.fadedOverlayController) {
			throw new Error("Required values not set")
		}

		this.newContent = accumulatedContent

		// Accumulate search/replace content
		if (accumulatedContent.includes("<<<<<<< SEARCH")) {
			this.accumulatedSearchReplaceContent += accumulatedContent
		}

		// Process content as it comes in
		const diffEditor = this.activeDiffEditor
		const document = diffEditor?.document
		if (!diffEditor || !document) {
			throw new Error("User closed text editor, unable to edit file...")
		}

		// Place cursor at the beginning of the diff editor
		const beginningOfDocument = new vscode.Position(0, 0)
		diffEditor.selection = new vscode.Selection(beginningOfDocument, beginningOfDocument)

		// Check if this is a new file
		const isNewFile = this.editType !== "modify"

		// Initialize content based on what's currently in the editor
		let currentContent = this.streamedLines.length === 0 ? (this.originalContent || "") : document.getText()

		// Process content when it's final or when we have a complete search/replace block
		if (isFinal || this.isSearchReplaceBlockComplete(this.accumulatedSearchReplaceContent)) {
			const contentToProcess = isFinal ? accumulatedContent : this.accumulatedSearchReplaceContent

			// Check for SEARCH/REPLACE blocks
			const hasSearchReplaceBlocks = contentToProcess.includes("<<<<<<< SEARCH")

			if (hasSearchReplaceBlocks) {
				// Process any SEARCH/REPLACE blocks
				let lastProcessedIndex = 0
				let searchStart = contentToProcess.indexOf("<<<<<<< SEARCH", lastProcessedIndex)
				
				while (searchStart !== -1) {
					const dividerStart = contentToProcess.indexOf("=======", searchStart)
					const replaceEnd = contentToProcess.indexOf(">>>>>>> REPLACE", searchStart)

					// Only process if we have a complete block
					if (dividerStart !== -1 && replaceEnd !== -1 && searchStart < dividerStart && dividerStart < replaceEnd) {
						// Extract the search and replace content
						const searchContent = contentToProcess.substring(searchStart + "<<<<<<< SEARCH".length, dividerStart).trim()
						const replaceContent = contentToProcess.substring(dividerStart + "=======".length, replaceEnd).trim()

						if (isNewFile) {
							// For new files, just use the replace content directly
							currentContent = replaceContent
							// Break after first block since we only need the replace content
							break
						} else {
							// For existing files, replace the search content with the replace content
							if (currentContent.includes(searchContent)) {
								currentContent = currentContent.replace(searchContent, replaceContent)
							}
						}

						lastProcessedIndex = replaceEnd + ">>>>>>> REPLACE".length
						searchStart = contentToProcess.indexOf("<<<<<<< SEARCH", lastProcessedIndex)
					} else {
						// Incomplete block, break the loop
						break
					}
				}
			} else {
				// For content without SEARCH/REPLACE blocks
				if (isNewFile) {
					// For new files, use the content as-is
					currentContent = accumulatedContent
				} else if (currentContent !== accumulatedContent) {
					// For existing files, only update if content has changed
					currentContent = accumulatedContent
				}
			}

			// Reset accumulated content if processing is complete
			if (isFinal) {
				this.accumulatedSearchReplaceContent = ""
			}
		}

		// Update only the right pane with the processed content
		const edit = new vscode.WorkspaceEdit()
		const fullRange = new vscode.Range(0, 0, document.lineCount, 0)
		edit.replace(document.uri, fullRange, currentContent)
		await vscode.workspace.applyEdit(edit)

		// Update streamedLines to track what we've processed
		this.streamedLines = currentContent.split("\n")

		// Update decorations
		const currentLine = this.streamedLines.length - 1
		if (currentLine >= 0) {
			this.activeLineController.setActiveLine(currentLine)
			this.fadedOverlayController.updateOverlayAfterLine(currentLine, document.lineCount)
			this.scrollEditorToLine(currentLine)
		}

		if (isFinal) {
			// Clear decorations since this is final
			this.fadedOverlayController.clear()
			this.activeLineController.clear()
		}
	}

	// Helper method to check if a search/replace block is complete
	private isSearchReplaceBlockComplete(content: string): boolean {
		const searchCount = (content.match(/<<<<<<< SEARCH/g) || []).length
		const replaceCount = (content.match(/>>>>>>> REPLACE/g) || []).length
		const dividerCount = (content.match(/=======/g) || []).length

		return searchCount > 0 && 
			   searchCount === replaceCount && 
			   searchCount === dividerCount
	}

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
		const editedContent = updatedDocument.getText()

		// If the content contains SEARCH/REPLACE blocks, use the CodeMerger
		if (editedContent.includes("<<<<<<< SEARCH")) {
			// First verify we have complete blocks
			const searchCount = (editedContent.match(/<<<<<<< SEARCH/g) || []).length
			const replaceCount = (editedContent.match(/>>>>>>> REPLACE/g) || []).length
			const dividerCount = (editedContent.match(/=======/g) || []).length

			// Check if we have matching markers
			if (searchCount !== replaceCount || searchCount !== dividerCount) {
				throw new Error("Incomplete SEARCH/REPLACE blocks detected. Please wait for the complete content to be loaded in the diff view.")
			}

			const codeMerger = new CodeMerger()
			try {
				const blocks = codeMerger.findCodeBlocks(editedContent)
				if (blocks.length > 0) {
					// Verify each block is complete and has content
					for (const block of blocks) {
						if (!block.original.trim() || !block.new.trim()) {
							throw new Error("Incomplete SEARCH/REPLACE block content detected. Please wait for the complete content to be loaded in the diff view.")
						}
					}

					let currentContent = ''
					if (this.editType === "modify") {
						currentContent = this.originalContent || ''
					}

					// Apply each block's changes sequentially
					for (const block of blocks) {
						const result = await codeMerger.applyCodeChange(
							block.filename,
							currentContent || block.original,
							block.original,
							block.new
						)
						if (!result.success) {
							throw new Error(`Auto-merge failed: ${result.error}\nPlease check that your SEARCH block exactly matches the file content.`)
						}
						currentContent = result.content!
					}

					// Verify the merged content is complete
					if (!currentContent.trim()) {
						throw new Error("Merged content is empty. Please wait for the complete content to be loaded in the diff view.")
					}

					// Save the merged content
					await fs.writeFile(absolutePath, currentContent)
					await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })
					await this.closeAllDiffViews()

					// Get diagnostics after the merge
					const postDiagnostics = vscode.languages.getDiagnostics()
					const newProblems = diagnosticsToProblemsString(
						getNewDiagnostics(this.preDiagnostics, postDiagnostics),
						[vscode.DiagnosticSeverity.Error],
						this.cwd
					)
					const newProblemsMessage = newProblems.length > 0 ? `\n\nNew problems detected after saving the file:\n${newProblems}` : ""

					return { 
						newProblemsMessage, 
						userEdits: undefined, // No user edits since we used auto-merger
						finalContent: currentContent 
					}
				}
			} catch (error) {
				// If auto-merge fails, show the error and prevent falling back to normal save behavior
				console.error("Auto-merge failed:", error)
				throw error
			}
		}

		// Normal save behavior for non-SEARCH/REPLACE content
		if (updatedDocument.isDirty) {
			await updatedDocument.save()
		}

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
				vscode.DiagnosticSeverity.Error, // only including errors since warnings can be distracting (if user wants to fix warnings they can use the @problems mention)
			],
			this.cwd,
		) // will be empty string if no errors
		const newProblemsMessage =
			newProblems.length > 0 ? `\n\nNew problems detected after saving the file:\n${newProblems}` : ""

		// If the edited content has different EOL characters, we don't want to show a diff with all the EOL differences.
		const newContentEOL = this.newContent.includes("\r\n") ? "\r\n" : "\n"
		const normalizedEditedContent = editedContent.replace(/\r\n|\n/g, newContentEOL).trimEnd() + newContentEOL // trimEnd to fix issue where editor adds in extra new line automatically
		// just in case the new content has a mix of varying EOL characters
		const normalizedNewContent = this.newContent.replace(/\r\n|\n/g, newContentEOL).trimEnd() + newContentEOL
		if (normalizedEditedContent !== normalizedNewContent) {
			// user made changes before approving edit
			const userEdits = formatResponse.createPrettyPatch(
				this.relPath.toPosix(),
				normalizedNewContent,
				normalizedEditedContent,
			)
			return { newProblemsMessage, userEdits, finalContent: normalizedEditedContent }
		} else {
			// no changes to cline's edits
			return { newProblemsMessage, userEdits: undefined, finalContent: normalizedEditedContent }
		}
	}

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

			// For the left pane (original content)
			const originalContent = fileExists ? this.originalContent : ""
			const originalUri = vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${fileName}`).with({
				query: Buffer.from(originalContent ?? "").toString("base64"),
			})

			// For the right pane (modified content)
			const modifiedUri = uri

			const disposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (editor && arePathsEqual(editor.document.uri.fsPath, uri.fsPath)) {
					disposable.dispose()
					resolve(editor)
				}
			})

			vscode.commands.executeCommand(
				"vscode.diff",
				originalUri,
				modifiedUri,
				`${fileName}: ${fileExists ? "Original ↔ Cline's Changes" : "New File"} (Editable)`,
				{
					preview: false,
					preserveFocus: false,
					viewColumn: vscode.ViewColumn.Active
				}
			)

			// This may happen on very slow machines ie project idx
			setTimeout(() => {
				disposable.dispose()
				reject(new Error("Failed to open diff editor, please try again..."))
			}, 10_000)
		})
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

