import { formatResponse } from "@core/prompts/responses"
import { workspaceResolver } from "@core/workspace"
import { createDirectoriesForFile } from "@utils/fs"
import { getCwd } from "@utils/path"
import * as diff from "diff"
import * as fs from "fs/promises"
import * as iconv from "iconv-lite"
import { HostProvider } from "@/hosts/host-provider"
import { diagnosticsToProblemsString, getNewDiagnostics } from "@/integrations/diagnostics"
import { DiagnosticSeverity, FileDiagnostics } from "@/shared/proto/index.cline"
import { detectEncoding } from "../misc/extract-text"
import { openFile } from "../misc/open-file"

export abstract class DiffViewProvider {
	editType?: "create" | "modify" | "delete"
	isEditing = false
	originalContent: string | undefined
	private createdDirs: string[] = []
	protected documentWasOpen = false
	private preDiagnostics: FileDiagnostics[] = []
	protected relPath?: string
	protected absolutePath?: string
	protected fileEncoding: string = "utf8"
	private streamedLines: string[] = []
	private newContent?: string

	constructor() {}

	public async open(relPath: string, options?: { displayPath?: string }): Promise<void> {
		this.isEditing = true
		const cwd = await getCwd()
		const absolutePathResolved = workspaceResolver.resolveWorkspacePath(cwd, relPath, "DiffViewProvider.open.absolutePath")
		this.absolutePath = typeof absolutePathResolved === "string" ? absolutePathResolved : absolutePathResolved.absolutePath
		this.relPath = options?.displayPath ?? relPath
		const fileExists = this.editType === "modify"

		// if the file is already open, ensure it's not dirty before getting its contents
		if (fileExists) {
			await HostProvider.workspace.saveOpenDocumentIfDirty({
				filePath: this.absolutePath!,
			})

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
		// get diagnostics before editing the file, we'll compare to diagnostics after editing to see if cline needs to fix anything
		this.preDiagnostics = (await HostProvider.workspace.getDiagnostics({})).fileDiagnostics
		await this.openDiffEditor()
		await this.scrollEditorToLine(0)
		this.streamedLines = []
	}

	/**
	 * Opens a diff editor or viewer for the current file.
	 *
	 * Called automatically by the `open` method after ensuring the file exists and
	 * creating any necessary directories.
	 *
	 * @returns A promise that resolves when the diff editor is open and ready
	 */
	protected abstract openDiffEditor(): Promise<void>

	/**
	 * Scrolls the diff editor to reveal a specific line.
	 *
	 * It's used during streaming updates to keep the user's view focused on the changing content.
	 *
	 * @param line The 0-based line number to scroll to
	 */
	protected abstract scrollEditorToLine(line: number): Promise<void>

	/**
	 * Creates a smooth scrolling animation between two lines in the diff editor.
	 *
	 * It's typically used when updates contain many lines, to help the user visually track the flow
	 * of significant changes in the document.
	 *
	 * @param startLine The 0-based line number to begin the animation from
	 * @param endLine The 0-based line number to animate to
	 */
	protected abstract scrollAnimation(startLine: number, endLine: number): Promise<void>

	/**
	 * Removes content from the specified line to the end of the document.
	 * Called after the final update is received.
	 */
	protected abstract truncateDocument(lineNumber: number): Promise<void>

	/**
	 * Get the contents of the diff editor document.
	 *
	 * Returns undefined if the diff editor was closed.
	 */
	protected abstract getDocumentText(): Promise<string | undefined>

	/**
	 * Get any new diagnostic problems that appeared after applying the diff.
	 *
	 * Getting diagnostics before and after the file edit is a better approach than
	 * automatically tracking problems in real-time. This method ensures we only
	 * report new problems that are a direct result of this specific edit.
	 * Since these are new problems resulting from Cline's edit, we know they're
	 * directly related to the work he's doing. This eliminates the risk of Cline
	 * going off-task or getting distracted by unrelated issues, which was a problem
	 * with the previous auto-debug approach. Some users' machines may be slow to
	 * update diagnostics, so this approach provides a good balance between automation
	 * and avoiding potential issues where Cline might get stuck in loops due to
	 * outdated problem information. If no new problems show up by the time the user
	 * accepts the changes, they can always debug later using the '@problems' mention.
	 * This way, Cline only becomes aware of new problems resulting from his edits
	 * and can address them accordingly. If problems don't change immediately after
	 * applying a fix, Cline won't be notified, which is generally fine since the
	 * initial fix is usually correct and it may just take time for linters to catch up.
	 */
	private async getNewDiagnosticProblems(): Promise<string> {
		// Get the diagnostics after changing the document.
		const postDiagnostics = (await HostProvider.workspace.getDiagnostics({})).fileDiagnostics

		const newProblems = getNewDiagnostics(this.preDiagnostics, postDiagnostics)
		// Only including errors since warnings can be distracting (if user wants to fix warnings they can use the @problems mention)
		// will be empty string if no errors
		const problems = await diagnosticsToProblemsString(newProblems, [DiagnosticSeverity.DIAGNOSTIC_ERROR])
		return problems
	}

	/**
	 * Save the contents of the diff editor UI to the file.
	 *
	 * @returns true if the file was saved.
	 */
	protected abstract saveDocument(): Promise<Boolean>

	/**
	 * Closes all open diff views.
	 */
	protected abstract closeAllDiffViews(): Promise<void>

	/**
	 * Cleans up the diff view resources and resets internal state.
	 */
	protected abstract resetDiffView(): Promise<void>

	async update(
		accumulatedContent: string,
		isFinal: boolean,
		changeLocation?: { startLine: number; endLine: number; startChar: number; endChar: number },
	) {
		if (!this.isEditing) {
			throw new Error("Not editing any file")
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

		// Instead of animating each line, we'll update in larger chunks
		const currentLine = this.streamedLines.length + diffLines.length - 1
		if (currentLine >= 0) {
			// Only proceed if we have new lines

			// Replace all content up to the current line with accumulated lines
			// This is necessary (as compared to inserting one line at a time) to handle cases where html tags
			// on previous lines are auto closed for example
			const contentToReplace = accumulatedLines.slice(0, currentLine + 1).join("\n") + "\n"
			const rangeToReplace = { startLine: 0, endLine: currentLine + 1 }
			await this.replaceText(contentToReplace, rangeToReplace, currentLine)

			// Scroll to the actual change location if provided.
			if (changeLocation) {
				// We have the actual location of the change, scroll to it
				const targetLine = changeLocation.startLine
				await this.scrollEditorToLine(targetLine)
			} else {
				// Fallback to the old logic for non-replacement updates
				if (diffLines.length <= 5) {
					// For small changes, just jump directly to the line
					await this.scrollEditorToLine(currentLine)
				} else {
					// For larger changes, create a quick scrolling animation
					const startLine = this.streamedLines.length
					const endLine = currentLine
					await this.scrollAnimation(startLine, endLine)
					// Ensure we end at the final line
					await this.scrollEditorToLine(currentLine)
				}
			}
		}

		// Update the streamedLines with the new accumulated content
		this.streamedLines = accumulatedLines
		if (isFinal) {
			// Handle any remaining lines if the new content is shorter than the original
			await this.truncateDocument(this.streamedLines.length)

			// Add empty last line if original content had one
			const hasEmptyLastLine = this.originalContent?.endsWith("\n")
			if (hasEmptyLastLine) {
				const accumulatedLines = accumulatedContent.split("\n")
				if (accumulatedLines[accumulatedLines.length - 1] !== "") {
					accumulatedContent += "\n"
				}
			}
		}
	}

	async showFile(absolutePath: string): Promise<void> {
		await openFile(absolutePath, true)
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
		currentLine: number | undefined,
	): Promise<void>

	async saveChanges(): Promise<{
		newProblemsMessage: string | undefined
		userEdits: string | undefined
		autoFormattingEdits: string | undefined
		finalContent: string | undefined
	}> {
		// get the contents before save operation which may do auto-formatting
		const preSaveContent = await this.getDocumentText()

		if (!this.relPath || !this.absolutePath || !this.newContent || preSaveContent === undefined) {
			return {
				newProblemsMessage: undefined,
				userEdits: undefined,
				autoFormattingEdits: undefined,
				finalContent: undefined,
			}
		}

		await this.saveDocument()
		// get text after save in case there is any auto-formatting done by the editor
		const postSaveContent = (await this.getDocumentText()) || ""

		await this.showFile(this.absolutePath)
		await this.closeAllDiffViews()

		const newProblems = await this.getNewDiagnosticProblems()
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
		if (!this.absolutePath || !this.isEditing) {
			return
		}
		const fileExists = this.editType === "modify"

		if (!fileExists) {
			// This is a load-bearing save statement- even though the file is saved and then immediately deleted.
			// In vscode, it will not close the diff editor correctly if the file is not saved.
			await this.saveDocument()
			await this.closeAllDiffViews()
			await fs.rm(this.absolutePath, { force: true })
			console.log(`File ${this.absolutePath} has been deleted.`)

			// Remove only the directories we created, in reverse order
			for (let i = this.createdDirs.length - 1; i >= 0; i--) {
				try {
					await fs.rmdir(this.createdDirs[i])
					console.log(`Directory ${this.createdDirs[i]} has been deleted.`)
				} catch (error) {
					console.log(`Could not delete directory ${this.createdDirs[i]}`, error)
				}
			}
		} else {
			// revert document
			// Apply the edit and save, since contents shouldn't have changed this won't show in local history unless of
			// course the user made changes and saved during the edit.
			const contents = (await this.getDocumentText()) || ""
			const lineCount = (contents.match(/\n/g) || []).length + 1
			await this.replaceText(this.originalContent ?? "", { startLine: 0, endLine: lineCount }, undefined)

			await this.saveDocument()
			console.log(`File ${this.absolutePath} has been reverted to its original content.`)
			if (this.documentWasOpen) {
				openFile(this.absolutePath, true)
			}
			await this.closeAllDiffViews()
		}

		// edit is done
		await this.reset()
	}

	async scrollToFirstDiff() {
		if (!this.isEditing) {
			return
		}
		const currentContent = (await this.getDocumentText()) || ""
		const diffs = diff.diffLines(this.originalContent || "", currentContent)
		let lineCount = 0
		for (const part of diffs) {
			if (part.added || part.removed) {
				// Found the first diff, scroll to it
				this.scrollEditorToLine(lineCount)
				return
			}
			if (!part.removed) {
				lineCount += part.count || 0
			}
		}
	}

	async deleteFile(fileName: string) {
		const fileLocation = this.absolutePath
		if (!fileLocation?.endsWith(fileName) || !this.isEditing) {
			return
		}

		// Close diff views before deleting the file
		await this.closeAllDiffViews()

		// Delete the file
		try {
			await fs.rm(fileLocation, { force: true })
			console.log(`File ${fileLocation} has been deleted.`)
		} catch (error) {
			console.error(`Failed to delete file ${fileLocation}:`, error)
		}

		this.isEditing = false
		this.newContent = undefined
	}

	// close editor if open?
	async reset() {
		this.isEditing = false
		this.editType = undefined
		this.absolutePath = undefined
		this.relPath = undefined
		this.preDiagnostics = []

		this.originalContent = undefined
		this.fileEncoding = "utf8"
		this.documentWasOpen = false

		this.streamedLines = []
		this.createdDirs = []
		this.newContent = undefined

		await this.resetDiffView()
	}
}
