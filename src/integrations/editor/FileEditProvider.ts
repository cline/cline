import { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import * as fs from "fs/promises"

/**
 * A file-system-based implementation of DiffViewProvider that performs direct file operations
 * without visual editor integration. This provider uses the Node.js fs package to handle
 * file edits in-memory and then writes them to disk.
 *
 * Visual operations like scrolling are implemented as no-ops since there is no UI component.
 * This makes it suitable for headless or non-interactive environments.
 */
export class FileEditProvider extends DiffViewProvider {
	private documentContent?: string

	constructor() {
		super()
	}

	override showFile(_absolutePath: string): Promise<void> {
		// No-op: No visual editor to show the file
		return Promise.resolve()
	}

	protected async openDiffEditor(): Promise<void> {
		// No-op: No visual editor to open in a file-system-only provider
		// The file content is already loaded in the base class's open() method
		this.documentContent = this.originalContent || ""
	}

	override async open(relPath: string, options?: { displayPath?: string }): Promise<void> {
		await super.open(relPath, options)
		this.documentContent = this.originalContent || ""
	}

	async replaceText(
		content: string,
		rangeToReplace: { startLine: number; endLine: number },
		_currentLine: number | undefined,
	): Promise<void> {
		if (this.documentContent === undefined) {
			throw new Error("Document not initialized")
		}

		// Split the document into lines
		const lines = this.documentContent.split("\n")

		// Replace the specified range with the new content
		const newContentLines = content.split("\n")
		// Remove trailing empty line if present in newContentLines for proper splicing
		if (newContentLines[newContentLines.length - 1] === "") {
			newContentLines.pop()
		}

		// Splice the lines array to replace the range
		lines.splice(rangeToReplace.startLine, rangeToReplace.endLine - rangeToReplace.startLine, ...newContentLines)

		// Join the lines back together
		this.documentContent = lines.join("\n")
	}

	protected async scrollEditorToLine(_line: number): Promise<void> {
		// No-op: No visual editor to scroll
	}

	protected async scrollAnimation(_startLine: number, _endLine: number): Promise<void> {
		// No-op: No visual editor to animate
	}

	protected async truncateDocument(lineNumber: number): Promise<void> {
		if (!this.documentContent) {
			return
		}

		// Split the document into lines and keep only up to lineNumber
		const lines = this.documentContent.split("\n")
		if (lineNumber < lines.length) {
			this.documentContent = lines.slice(0, lineNumber).join("\n")
		}
	}

	protected async getDocumentText(): Promise<string | undefined> {
		return this.documentContent
	}

	/**
	 * Public method to get the current document content.
	 * This is exposed for use by tools that need to read the document state.
	 */
	public async getContent(): Promise<string | undefined> {
		return this.getDocumentText()
	}

	protected async saveDocument(): Promise<Boolean> {
		if (!this.absolutePath || !this.documentContent) {
			return false
		}

		try {
			// Write the content to the file using fs
			await fs.writeFile(this.absolutePath, this.documentContent, { encoding: this.fileEncoding as BufferEncoding })
			return true
		} catch (error) {
			console.error(`Failed to save document to ${this.absolutePath}:`, error)
			return false
		}
	}

	protected async closeAllDiffViews(): Promise<void> {
		// No-op: No visual diff views to close
	}

	protected async resetDiffView(): Promise<void> {
		// Clean up the in-memory document content
		this.documentContent = undefined
	}
}
