import * as fs from "fs/promises"
import * as iconv from "iconv-lite"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"

/**
 * Standalone DiffViewProvider for CLI mode.
 *
 * This implementation works directly with the filesystem instead of
 * relying on VSCode's diff editor UI. It stores content in memory
 * during editing and writes directly to disk on save.
 */
export class StandaloneDiffViewProvider extends DiffViewProvider {
	/** Accumulated content during streaming edits */
	private accumulatedContent: string = ""

	/** Logger function for CLI output */
	private log: (message: string) => void

	constructor(log?: (message: string) => void) {
		super()
		this.log = log ?? console.log
	}

	/**
	 * Opens a diff editor - no-op for CLI since we don't have a visual editor.
	 * We just log that editing has started.
	 */
	protected override async openDiffEditor(): Promise<void> {
		// Initialize accumulated content with original content (or empty for new files)
		this.accumulatedContent = this.originalContent ?? ""
		this.log(`Editing: ${this.relPath}`)
	}

	/**
	 * Replaces text in the document. For CLI mode, we just store the content in memory.
	 */
	override async replaceText(
		content: string,
		_rangeToReplace: { startLine: number; endLine: number },
		_currentLine: number | undefined,
	): Promise<void> {
		this.accumulatedContent = content
	}

	/**
	 * Returns the current document content from memory.
	 */
	protected override async getDocumentText(): Promise<string | undefined> {
		return this.accumulatedContent
	}

	/**
	 * Saves the document to disk with proper encoding.
	 */
	protected override async saveDocument(): Promise<Boolean> {
		if (!this.absolutePath) {
			return false
		}
		try {
			const encoded = iconv.encode(this.accumulatedContent, this.fileEncoding)
			await fs.writeFile(this.absolutePath, encoded)
			this.log(`Saved: ${this.relPath}`)
			return true
		} catch (error) {
			this.log(`Error saving ${this.relPath}: ${error}`)
			return false
		}
	}

	/**
	 * Truncates the document to the specified line number.
	 * For CLI mode, we truncate the in-memory content.
	 */
	protected override async truncateDocument(lineNumber: number): Promise<void> {
		const lines = this.accumulatedContent.split("\n")
		this.accumulatedContent = lines.slice(0, lineNumber).join("\n")
	}

	/**
	 * Scrolls to a specific line - no-op for CLI since there's no visual editor.
	 */
	protected override async scrollEditorToLine(_line: number): Promise<void> {
		// No-op - CLI doesn't have a visual editor to scroll
	}

	/**
	 * Scroll animation - no-op for CLI since there's no visual editor.
	 */
	override async scrollAnimation(_startLine: number, _endLine: number): Promise<void> {
		// No-op - CLI doesn't have a visual editor to animate
	}

	/**
	 * Closes all diff views - no-op for CLI since there's no visual editor.
	 */
	protected override async closeAllDiffViews(): Promise<void> {
		// No-op - CLI doesn't have diff views to close
	}

	/**
	 * Resets the diff view state.
	 */
	protected override async resetDiffView(): Promise<void> {
		this.accumulatedContent = ""
	}

	/**
	 * Shows a file - for CLI, we just log that the file was modified.
	 */
	override async showFile(_absolutePath: string): Promise<void> {
		// No-op for CLI - we don't open files in an editor
	}
}
