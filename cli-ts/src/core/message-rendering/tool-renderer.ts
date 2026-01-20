/**
 * Tool Renderer
 *
 * Handles rendering of tool-related messages including tool operations,
 * tool approval requests, and diff output formatting.
 */

import type { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import type { RenderContext } from "./types.js"

/**
 * ToolRenderer class
 *
 * Renders tool-related messages to the terminal, including:
 * - Tool operation results (file edits, reads, searches, etc.)
 * - Tool approval requests with diffs
 * - Diff formatting with color-coded additions/deletions
 */
export class ToolRenderer {
	constructor(private ctx: RenderContext) {}

	/**
	 * Render a tool operation message (say type)
	 *
	 * @param msg - The ClineMessage with tool information
	 */
	renderToolMessage(msg: ClineMessage): void {
		if (!msg.text) {
			return
		}

		try {
			const tool = JSON.parse(msg.text) as ClineSayTool
			switch (tool.tool) {
				case "editedExistingFile":
					this.ctx.formatter.raw(`\n📝 Edited: ${tool.path || "file"}`)
					if (tool.diff) {
						this.renderDiff(tool.diff)
					}
					break

				case "newFileCreated":
					this.ctx.formatter.raw(`\n📄 Created: ${tool.path || "file"}`)
					break

				case "fileDeleted":
					this.ctx.formatter.raw(`\n🗑 Deleted: ${tool.path || "file"}`)
					break

				case "readFile":
					this.ctx.formatter.raw(`\n📖 Read: ${tool.path || "file"}`)
					break

				case "listFilesTopLevel":
				case "listFilesRecursive":
					this.ctx.formatter.raw(`\n📂 Listed: ${tool.path || "directory"}`)
					break

				case "searchFiles":
					this.ctx.formatter.raw(`\n🔍 Searched: ${tool.regex || "pattern"} in ${tool.path || "directory"}`)
					break

				case "webFetch":
				case "webSearch":
					this.ctx.formatter.raw(`\n🌐 Web: ${tool.content || ""}`)
					break

				default:
					this.ctx.formatter.raw(`\n🔧 Tool: ${tool.tool}`)
			}
		} catch {
			// Not JSON, just output raw
			this.ctx.formatter.raw(`\n🔧 ${msg.text}`)
		}
	}

	/**
	 * Render a tool approval request (ask type)
	 *
	 * @param msg - The ClineMessage with tool approval information
	 */
	renderToolApproval(msg: ClineMessage): void {
		if (!msg.text) {
			this.ctx.formatter.raw(`\n🔧 Tool approval required`)
			return
		}

		try {
			const tool = JSON.parse(msg.text) as ClineSayTool
			this.ctx.formatter.raw(`\n🔧 Approve ${tool.tool}?`)
			if (tool.path) {
				this.ctx.formatter.raw(`  Path: ${tool.path}`)
			}
			// Check both diff and content fields - the extension stores diffs in content field
			const diffContent = tool.diff || tool.content
			if (diffContent && (tool.tool === "editedExistingFile" || tool.tool === "newFileCreated")) {
				this.renderDiff(diffContent)
			}
			// Show appropriate auto-approve hint based on tool type
			const autoApproveHint = this.getAutoApproveHint(tool.tool)
			this.ctx.formatter.info(`  [y/n]${autoApproveHint}`)
		} catch {
			this.ctx.formatter.raw(`\n🔧 Tool approval: ${msg.text}`)
			this.ctx.formatter.info("  [y/n] or [yy to auto-approve]")
		}
	}

	/**
	 * Render diff content with color-coded additions and deletions
	 *
	 * @param diff - The diff string to render
	 */
	renderDiff(diff: string): void {
		const lines = diff.split("\n")
		for (const line of lines) {
			if (line.startsWith("+")) {
				this.ctx.formatter.raw(`  \x1b[32m${line}\x1b[0m`) // Green for additions
			} else if (line.startsWith("-")) {
				this.ctx.formatter.raw(`  \x1b[31m${line}\x1b[0m`) // Red for deletions
			} else {
				this.ctx.formatter.raw(`  ${line}`)
			}
		}
	}

	/**
	 * Get the auto-approve hint text based on tool type
	 *
	 * @param toolType - The type of tool being approved
	 * @returns Hint text for auto-approval
	 */
	getAutoApproveHint(toolType: string): string {
		switch (toolType) {
			case "editedExistingFile":
			case "newFileCreated":
			case "fileDeleted":
				return " or [yy to auto-approve edits]"
			case "readFile":
			case "listFilesTopLevel":
			case "listFilesRecursive":
			case "listCodeDefinitionNames":
			case "searchFiles":
			case "webFetch":
			case "webSearch":
				return " or [yy to auto-approve reads]"
			default:
				return " or [yy to auto-approve]"
		}
	}
}
