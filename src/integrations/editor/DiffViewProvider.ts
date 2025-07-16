import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { createDirectoriesForFile } from "@utils/fs"
import { arePathsEqual, getCwd } from "@utils/path"
import { formatResponse } from "@core/prompts/responses"
import * as diff from "diff"

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
	private newContent?: string
	private streamedLines: string[] = []

	protected fileEncoding: string = "utf8"
	private scrollListener?: vscode.Disposable

	constructor() {}

	async open(relPath: string): Promise<void> {
		console.log("sjfsjf open diff ", relPath)
		this.relPath = relPath
		const cwd = await getCwd()
		this.absolutePath = path.resolve(cwd, relPath)

		const fileExists = this.editType === "modify"
		this.isEditing = true
		// if the file is already open, ensure it's not dirty before getting its contents
		if (fileExists) {
			// TODO(fortunes) Switch this to host bridge WorkspaceService.saveDocument(absolutePath)
			const existingDocument = vscode.workspace.textDocuments.find((doc) =>
				arePathsEqual(doc.uri.fsPath, this.absolutePath),
			)
			if (existingDocument && existingDocument.isDirty) {
				await existingDocument.save()
			}
		}

		if (fileExists) {
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

		this.scrollToLine(0) // will this crash for new files?
		this.streamedLines = []
	}

	abstract openDiffEditor(): Promise<void>
	abstract setCursor(line: number, character: number): void
	abstract scrollToLine(line: number): void
	abstract saveDocument(): Promise<void>
	abstract getDocumentText(): Promise<string | undefined>
	abstract replaceText(
		content: string,
		rangeToReplace: { startLine: number; endLine: number },
		currentLine: number,
	): Promise<void>
	abstract truncateDocument(lineNumber: number): Promise<void>
	abstract revertDocument(): Promise<void>
	abstract scrollAnimation(startLine: number, endLine: number): Promise<void>
	abstract closeAllDiffViews(): Promise<void>
	abstract resetDiffView(): Promise<void>
	abstract getNewDiagnosticProblems(): Promise<string>

	async update(
		accumulatedContent: string,
		isFinal: boolean,
		changeLocation?: { startLine: number; endLine: number; startChar: number; endChar: number },
	) {
		console.log("sjfsjf  diff update ", JSON.stringify(accumulatedContent).substring(0, 100))

		if (!this.relPath) {
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

		// Place cursor at the beginning of the diff editor to keep it out of the way of the stream animation
		this.setCursor(0, 0)

		// Instead of animating each line, we'll update in larger chunks
		const currentLine = this.streamedLines.length + diffLines.length - 1
		if (currentLine >= 0) {
			// Only proceed if we have new lines

			// Replace all content up to the current line with accumulated lines
			// This is necessary (as compared to inserting one line at a time) to handle cases where html tags on previous lines are auto closed for example
			const rangeToReplace = { startLine: 0, startChar: 0, endLine: currentLine + 1, endChar: 0 }
			const contentToReplace = accumulatedLines.slice(0, currentLine + 1).join("\n") + "\n"
			await this.replaceText(contentToReplace, rangeToReplace, currentLine)

			// Scroll to the actual change location if provided.
			if (changeLocation) {
				// We have the actual location of the change, scroll to it
				const targetLine = changeLocation.startLine
				this.scrollToLine(targetLine)
			} else {
				// Fallback to the old logic for non-replacement updates
				if (diffLines.length <= 5) {
					// For small changes, just jump directly to the line
					this.scrollToLine(currentLine)
				} else {
					// For larger changes, create a quick scrolling animation
					// Create and await the smooth scrolling animation
					const startLine = this.streamedLines.length
					const endLine = currentLine
					await this.scrollAnimation(startLine, endLine)
					// Ensure we end at the final line
					this.scrollToLine(currentLine)
				}
			}
		}

		// Update the streamedLines with the new accumulated content
		this.streamedLines = accumulatedLines
		if (isFinal) {
			// Handle any remaining lines if the new content is shorter than the original
			this.truncateDocument(this.streamedLines.length)
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

	async saveChanges(): Promise<{
		newProblemsMessage: string | undefined
		userEdits: string | undefined
		autoFormattingEdits: string | undefined
		finalContent: string | undefined
	}> {
		const preSaveContent = await this.getDocumentText()

		console.log("sjfsjf  diff save ", JSON.stringify(preSaveContent).substring(0, 100))

		// get the contents before save operation which may do auto-formatting
		if (!this.relPath || !this.newContent || !preSaveContent) {
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
		console.log("sjfsjf diff revert ", this.relPath)

		if (!this.relPath || !this.absolutePath) {
			return
		}
		const fileExists = this.editType === "modify"

		if (!fileExists) {
			await this.saveDocument()
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
			await this.revertDocument()
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

	async scrollToFirstDiff() {
		console.log("sjfsjf diff scrollToFirstDiff ")

		const currentContent = await this.getDocumentText()
		if (!currentContent) {
			return
		}
		const diffs = diff.diffLines(this.originalContent || "", currentContent)
		let lineCount = 0
		for (const part of diffs) {
			if (part.added || part.removed) {
				// Found the first diff, scroll to it
				this.scrollToLine(lineCount)
				return
			}
			if (!part.removed) {
				lineCount += part.count || 0
			}
		}
	}

	// close editor if open?
	async reset() {
		console.log("sjfsjf diff reset ")

		this.editType = undefined
		this.isEditing = false
		this.originalContent = undefined
		this.createdDirs = []
		this.documentWasOpen = false
		this.resetDiffView()
		this.streamedLines = []

		// Clean up the scroll listener
		if (this.scrollListener) {
			this.scrollListener.dispose()
			this.scrollListener = undefined
		}
	}
}
