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
		const originalEndsWithNewline = this.documentContent.endsWith("\n")

		// If original ends with newline, split creates a trailing empty string that isn't a real line.
		// Remove it for line-based operations, we'll add it back at the end if needed.
		const realLines = originalEndsWithNewline && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines

		// Replace the specified range with the new content
		const newContentLines = content.split("\n")
		const contentEndsWithNewline = content.endsWith("\n")

		// Determine if we're replacing to the end of the document
		const replacingToEnd = rangeToReplace.endLine >= realLines.length

		// Handle trailing empty string from split:
		// - If content ends with \n, split creates an empty string at the end
		// - When replacing to end: this empty string becomes the document's trailing newline - keep it
		// - When replacing middle: this empty string would create an extra newline - remove it
		//   (the join operation will naturally add newlines between lines)
		// - If content doesn't end with \n but split created empty string, remove it
		if (!contentEndsWithNewline && newContentLines[newContentLines.length - 1] === "") {
			newContentLines.pop()
		} else if (contentEndsWithNewline && !replacingToEnd && newContentLines[newContentLines.length - 1] === "") {
			// Content ends with newline but we're replacing middle section - remove trailing empty string
			newContentLines.pop()
		}

		// Splice the real lines array to replace the range
		realLines.splice(rangeToReplace.startLine, rangeToReplace.endLine - rangeToReplace.startLine, ...newContentLines)

		// Join the lines back together
		let result = realLines.join("\n")

		// Preserve trailing newline: add it back if original had one OR if we replaced to end with content that ends with newline
		const shouldHaveTrailingNewline = originalEndsWithNewline || (replacingToEnd && contentEndsWithNewline)
		if (shouldHaveTrailingNewline && !result.endsWith("\n")) {
			result += "\n"
		} else if (!shouldHaveTrailingNewline && result.endsWith("\n")) {
			// Shouldn't have trailing newline but result has one - remove it
			result = result.slice(0, -1)
		}

		this.documentContent = result
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
