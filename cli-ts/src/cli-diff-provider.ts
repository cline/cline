/**
 * CLI-specific DiffViewProvider implementation
 * Handles diff display in the terminal
 */

import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import { print, separator, style } from "./display"

export class CliDiffViewProvider extends DiffViewProvider {
	private documentContent: string = ""

	// ========== Abstract method implementations ==========

	protected override async openDiffEditor(): Promise<void> {
		print(separator())
		print(style.info(`📝 Diff for: ${this.relPath}`))
		print(separator("-"))
	}

	protected override async scrollEditorToLine(_line: number): Promise<void> {
		// No-op in CLI - terminal doesn't support scrolling to specific lines
	}

	protected override async scrollAnimation(_startLine: number, _endLine: number): Promise<void> {
		// No-op in CLI - terminal doesn't support scroll animations
	}

	protected override async truncateDocument(_lineNumber: number): Promise<void> {
		// No-op in CLI - we manage content differently
	}

	protected override async getDocumentText(): Promise<string | undefined> {
		return this.documentContent
	}

	protected override async saveDocument(): Promise<Boolean> {
		print(style.success("Changes saved"))
		return true
	}

	protected override async closeAllDiffViews(): Promise<void> {
		print(separator())
	}

	protected override async resetDiffView(): Promise<void> {
		this.documentContent = ""
	}

	override async replaceText(
		content: string,
		_rangeToReplace: { startLine: number; endLine: number },
		_currentLine: number | undefined,
	): Promise<void> {
		this.documentContent = content

		// Print a simple diff summary when content changes
		const lines = content.split("\n")
		const originalLines = (this.originalContent ?? "").split("\n")

		// Count additions and deletions
		let additions = 0
		let deletions = 0

		const maxLines = Math.max(lines.length, originalLines.length)
		for (let i = 0; i < maxLines; i++) {
			const origLine = originalLines[i]
			const newLine = lines[i]
			if (origLine !== newLine) {
				if (origLine && !newLine) {
					deletions++
				} else if (!origLine && newLine) {
					additions++
				} else {
					additions++
					deletions++
				}
			}
		}

		// Only print summary on significant changes to avoid spam
		if (additions > 0 || deletions > 0) {
			print(style.dim(`  +${additions} -${deletions} lines`))
		}
	}
}
