import * as diff from "diff"
import { formatResponse } from "@core/prompts/responses"

/**
 * Handles diff display in the Electron standalone app using text-based rendering
 * This is used when DiffViewProvider cannot be used (Electron context)
 */
export class ElectronDiffHandler {
	private originalContent: string = ""
	private newContent: string = ""
	private relPath: string = ""

	/**
	 * Initialize with file path and original content
	 */
	async open(relPath: string, originalContent: string = ""): Promise<void> {
		this.relPath = relPath
		this.originalContent = originalContent
		this.newContent = ""
	}

	/**
	 * Update the new content for diff display
	 */
	async update(newContent: string, isFinal: boolean): Promise<void> {
		this.newContent = newContent

		if (isFinal) {
			// Generate and log the diff for debugging/display purposes
			const diffText = this.generateTextDiff()
			console.log(`[ELECTRON-DIFF] Final diff for ${this.relPath}:`)
		}
	}

	/**
	 * Generate a text-based diff representation
	 */
	private generateTextDiff(): string {
		if (!this.originalContent && !this.newContent) {
			return "No content to diff"
		}

		// Use the diff library to create a unified diff
		const diffLines = diff.diffLines(this.originalContent, this.newContent)
		let result = `--- ${this.relPath} (original)\n+++ ${this.relPath} (modified)\n`

		let addedLines = 0
		let removedLines = 0

		for (const part of diffLines) {
			if (part.added) {
				part.value
					.split("\n")
					.slice(0, -1)
					.forEach((line) => {
						result += `+ ${line}\n`
						addedLines++
					})
			} else if (part.removed) {
				part.value
					.split("\n")
					.slice(0, -1)
					.forEach((line) => {
						result += `- ${line}\n`
						removedLines++
					})
			} else {
				// Show some context lines
				const lines = part.value.split("\n").slice(0, -1)
				lines.slice(0, 3).forEach((line) => {
					result += `  ${line}\n`
				})
				if (lines.length > 6) {
					result += "  ...\n"
				}
				lines.slice(-3).forEach((line) => {
					result += `  ${line}\n`
				})
			}
		}

		return `${result}\n--- Summary: +${addedLines} -${removedLines} lines ---`
	}

	/**
	 * Create a pretty patch for display
	 */
	createPrettyPatch(): string {
		return formatResponse.createPrettyPatch(this.relPath, this.originalContent, this.newContent)
	}

	/**
	 * Reset the handler state
	 */
	async reset(): Promise<void> {
		this.originalContent = ""
		this.newContent = ""
		this.relPath = ""
	}

	/**
	 * No-op for Electron - files aren't saved through this handler
	 */
	async saveChanges(): Promise<{
		newProblemsMessage: string
		userEdits: string | undefined
		autoFormattingEdits: string | undefined
		finalContent: string
	}> {
		return {
			newProblemsMessage: "",
			userEdits: undefined,
			autoFormattingEdits: undefined,
			finalContent: this.newContent,
		}
	}

	/**
	 * No-op for Electron - no changes to revert in text display
	 */
	async revertChanges(): Promise<void> {
		// Nothing to revert in text-based display
	}

	/**
	 * Get the current editing state
	 */
	get isEditing(): boolean {
		return this.relPath !== ""
	}

	/**
	 * Get edit type based on original content
	 */
	get editType(): "create" | "modify" | undefined {
		if (this.relPath === "") {
			return undefined
		}
		return this.originalContent === "" ? "create" : "modify"
	}
}
