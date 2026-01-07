import { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import * as path from "path"
import * as vscode from "vscode"
import { DecorationController } from "@/hosts/vscode/DecorationController"
import { Logger } from "@/services/logging/Logger"
import { arePathsEqual } from "@/utils/path"

export const DIFF_VIEW_URI_SCHEME = "cline-diff"

export class VscodeDiffViewProvider extends DiffViewProvider {
	private activeDiffEditor?: vscode.TextEditor

	private fadedOverlayController?: DecorationController
	private activeLineController?: DecorationController

	// Temporary file management for notebook diff views
	private tempModifiedUri?: vscode.Uri
	private tempFileWatcher?: vscode.FileSystemWatcher

	override async openDiffEditor(): Promise<void> {
		if (!this.absolutePath) {
			throw new Error("No file path set")
		}

		// if the file was already open, close it (must happen after showing the diff view since if it's the only tab the column will close)
		this.documentWasOpen = false
		// close the tab if it's open (it's already been saved)
		const tabs = vscode.window.tabGroups.all
			.flatMap((tg) => tg.tabs)
			.filter((tab) => tab.input instanceof vscode.TabInputText && arePathsEqual(tab.input.uri.fsPath, this.absolutePath))
		for (const tab of tabs) {
			if (!tab.isDirty) {
				try {
					await vscode.window.tabGroups.close(tab)
				} catch (error) {
					console.warn("Tab close retry failed:", error.message)
				}
			}
			this.documentWasOpen = true
		}

		const uri = vscode.Uri.file(this.absolutePath)
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
			// Use already open diff editor.
			this.activeDiffEditor = await vscode.window.showTextDocument(diffTab.input.modified, {
				preserveFocus: true,
			})
		} else {
			// Open new diff editor.
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
					vscode.Uri.from({
						scheme: DIFF_VIEW_URI_SCHEME,
						path: fileName,
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

	override async replaceText(
		content: string,
		rangeToReplace: { startLine: number; endLine: number },
		currentLine: number | undefined,
	): Promise<void> {
		if (!this.activeDiffEditor || !this.activeDiffEditor.document) {
			throw new Error("User closed text editor, unable to edit file...")
		}

		// Place cursor at the beginning of the diff editor to keep it out of the way of the stream animation
		const beginningOfDocument = new vscode.Position(0, 0)
		this.activeDiffEditor.selection = new vscode.Selection(beginningOfDocument, beginningOfDocument)

		// Replace the text in the diff editor document.
		const document = this.activeDiffEditor?.document
		const edit = new vscode.WorkspaceEdit()
		const range = new vscode.Range(rangeToReplace.startLine, 0, rangeToReplace.endLine, 0)
		edit.replace(document.uri, range, content)
		await vscode.workspace.applyEdit(edit)

		if (currentLine !== undefined) {
			// Update decorations for the entire changed section
			this.activeLineController?.setActiveLine(currentLine)
			this.fadedOverlayController?.updateOverlayAfterLine(currentLine, document.lineCount)
		}
	}

	override async scrollEditorToLine(line: number): Promise<void> {
		if (!this.activeDiffEditor) {
			return
		}
		const scrollLine = line + 4
		this.activeDiffEditor.revealRange(new vscode.Range(scrollLine, 0, scrollLine, 0), vscode.TextEditorRevealType.InCenter)
	}

	override async scrollAnimation(startLine: number, endLine: number): Promise<void> {
		if (!this.activeDiffEditor) {
			return
		}
		const totalLines = endLine - startLine
		const numSteps = 10 // Adjust this number to control animation speed
		const stepSize = Math.max(1, Math.floor(totalLines / numSteps))

		// Create and await the smooth scrolling animation
		for (let line = startLine; line <= endLine; line += stepSize) {
			this.activeDiffEditor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter)
			await new Promise((resolve) => setTimeout(resolve, 16)) // ~60fps
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

	protected override async getDocumentText(): Promise<string | undefined> {
		if (!this.activeDiffEditor || !this.activeDiffEditor.document) {
			return undefined
		}
		return this.activeDiffEditor.document.getText()
	}

	protected override async saveDocument(): Promise<Boolean> {
		if (!this.activeDiffEditor) {
			return false
		}
		if (!this.activeDiffEditor.document.isDirty) {
			return false
		}
		await this.activeDiffEditor.document.save()
		return true
	}

	protected override async switchToSpecializedEditor(): Promise<void> {
		if (!this.isNotebookFile() || !this.activeDiffEditor || !this.absolutePath) {
			Logger.log(
				`switchToSpecializedEditor: Early return - isNotebook: ${this.isNotebookFile()}, hasActiveDiffEditor: ${!!this.activeDiffEditor}, hasAbsolutePath: ${!!this.absolutePath}`,
			)
			return
		}

		// Check if enhanced notebook interaction is enabled
		Logger.log(`switchToSpecializedEditor: Enhanced notebook interaction enabled: ${this.enhancedNotebookInteractionEnabled}`)
		if (!this.enhancedNotebookInteractionEnabled) {
			Logger.log("switchToSpecializedEditor: Enhanced notebook interaction is disabled, skipping notebook diff view")
			return
		}

		try {
			const uri = vscode.Uri.file(this.absolutePath)
			const fileName = path.basename(uri.fsPath)

			Logger.log(`Attempting to create notebook diff view for file: ${fileName}`)

			// Check if Jupyter extension is available
			const jupyterExtension = vscode.extensions.getExtension("ms-toolsai.jupyter")
			if (!jupyterExtension) {
				Logger.log("Jupyter extension not found, cannot create notebook diff view")
				return
			}

			if (!jupyterExtension.isActive) {
				Logger.log("Jupyter extension not active, activating...")
				await jupyterExtension.activate()
			}

			// Create a proper notebook diff view by creating temporary files
			await this.createNotebookDiffView(uri, fileName)
		} catch (error) {
			Logger.error("Failed to create notebook diff view, continuing with text editor:", error)
			// Text editor remains active - no changes needed
		}
	}

	/**
	 * Create a proper notebook diff view using temporary files
	 */
	private async createNotebookDiffView(uri: vscode.Uri, fileName: string): Promise<void> {
		try {
			Logger.log("Creating notebook diff view with temporary file...")

			// Create temporary directory and file for modified content (right side)
			const tempDir = require("os").tmpdir()
			const timestamp = Date.now()
			const tempModifiedPath = path.join(tempDir, `cline-modified-${timestamp}-${fileName}`)

			// Write current editor content to temporary file
			const currentContent = this.activeDiffEditor?.document.getText() ?? ""

			try {
				// Attempt to parse the content as JSON
				JSON.parse(currentContent)
			} catch (error) {
				Logger.error(`Invalid JSON content for notebook file ${fileName}, skipping notebook diff view creation`)
				Logger.error(`JSON parse error: ${error}`)
				return
			}

			await vscode.workspace.fs.writeFile(vscode.Uri.file(tempModifiedPath), new TextEncoder().encode(currentContent))

			// Store temporary file URI for cleanup
			this.tempModifiedUri = vscode.Uri.file(tempModifiedPath)
			Logger.log(`Created temporary modified file: ${tempModifiedPath}`)

			// Close current text diff editor
			// await this.closeCurrentTextDiffEditor()

			// Set up file system watcher for synchronization
			this.setupTempDocumentListener()

			// Open notebook diff view with original file (left) vs temporary file (right)
			Logger.log("Opening notebook diff view...")
			await vscode.commands.executeCommand(
				"vscode.diff",
				uri, // Left: original file
				this.tempModifiedUri, // Right: temporary file with modifications
				`${fileName}: Original ↔ Cline's Changes (Notebook)`,
			)

			// Give VS Code a moment to open the notebook diff view
			await new Promise((resolve) => setTimeout(resolve, 500))

			Logger.log("Notebook diff view opened successfully")
		} catch (error) {
			Logger.error(`Error creating notebook diff view: ${error}`)
			// Clean up on error
			await this.cleanupTempFiles()
			return
		}
	}

	/**
	 * Set up file system watcher for temporary file synchronization
	 */
	private setupTempDocumentListener(): void {
		if (this.tempModifiedUri) {
			this.tempFileWatcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(this.tempModifiedUri.fsPath, "*"),
			)

			this.tempFileWatcher.onDidChange(async () => {
				await this.syncTempFileToActiveDiffEditor()
			})

			Logger.log(`File system watcher set up for temp file: ${this.tempModifiedUri.fsPath}`)
		}
	}

	/**
	 * Sync changes from temporary file back to active diff editor only
	 */
	private async syncTempFileToActiveDiffEditor(): Promise<void> {
		if (this.tempModifiedUri && this.activeDiffEditor && this.activeDiffEditor.document) {
			try {
				const tempContent = await vscode.workspace.fs.readFile(this.tempModifiedUri)
				const tempContentString = new TextDecoder().decode(tempContent)

				// Update text editor content to match temporary file
				const edit = new vscode.WorkspaceEdit()
				const fullRange = new vscode.Range(0, 0, this.activeDiffEditor.document.lineCount, 0)
				edit.replace(this.activeDiffEditor.document.uri, fullRange, tempContentString)
				await vscode.workspace.applyEdit(edit)

				Logger.log("Synced temp file changes back to active diff editor")
			} catch (error) {
				Logger.error("Failed to sync temp file to active diff editor:", error)
			}
		}
	}

	protected async closeAllDiffViews(): Promise<void> {
		// Close all the cline diff views (both text and notebook diff views).
		const tabs = vscode.window.tabGroups.all
			.flatMap((tg) => tg.tabs)
			.filter((tab) => {
				// Regular Cline text diff views
				if (tab.input instanceof vscode.TabInputTextDiff && tab.input?.original?.scheme === DIFF_VIEW_URI_SCHEME) {
					return true
				}

				// Notebook diff views created by createNotebookDiffView()
				if (
					tab.input instanceof vscode.TabInputNotebookDiff &&
					tab.input?.modified?.fsPath?.includes("cline-modified-")
				) {
					return true
				}

				return false
			})
		for (const tab of tabs) {
			// trying to close dirty views results in save popup
			if (!tab.isDirty) {
				try {
					await vscode.window.tabGroups.close(tab)
				} catch (error) {
					console.warn("Tab close retry failed:", error.message)
				}
			}
		}
	}

	protected override async resetDiffView(): Promise<void> {
		// Clean up temporary files and listeners (basic cleanup for now)
		await this.cleanupTempFiles()

		this.activeDiffEditor = undefined
		this.fadedOverlayController = undefined
		this.activeLineController = undefined
	}

	/**
	 * Clean up temporary files and watchers (basic implementation)
	 */
	private async cleanupTempFiles(): Promise<void> {
		// Dispose file watcher first
		if (this.tempFileWatcher) {
			this.tempFileWatcher.dispose()
			this.tempFileWatcher = undefined
		}

		// Clean up temporary file
		if (this.tempModifiedUri) {
			try {
				await vscode.workspace.fs.delete(this.tempModifiedUri)
				Logger.log(`Cleaned up temporary file: ${this.tempModifiedUri.fsPath}`)
			} catch (error) {
				// Log but don't throw - cleanup should be non-blocking
				Logger.log(`Failed to cleanup temporary file: ${error}`)
			}
			this.tempModifiedUri = undefined
		}
	}
}
