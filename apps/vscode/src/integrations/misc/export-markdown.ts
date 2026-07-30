import type { ContentBlock, Message } from "@cline/llms"
import { writeFile } from "@utils/fs"
import os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { openFile } from "./open-file"

/**
 * Exports a task's conversation history as a markdown file. Prompts the user
 * for a save location (defaulting to ~/Downloads), writes the file, and opens it.
 */
export async function downloadTask(dateTs: number, conversationHistory: Message[]) {
	// File name
	const date = new Date(dateTs)
	const month = date.toLocaleString("en-US", { month: "short" }).toLowerCase()
	const day = date.getDate()
	const year = date.getFullYear()
	let hours = date.getHours()
	const minutes = date.getMinutes().toString().padStart(2, "0")
	const seconds = date.getSeconds().toString().padStart(2, "0")
	const ampm = hours >= 12 ? "pm" : "am"
	hours = hours % 12
	hours = hours ? hours : 12 // the hour '0' should be '12'
	const fileName = `cline_task_${month}-${day}-${year}_${hours}-${minutes}-${seconds}-${ampm}.md`

	// Generate markdown
	const markdownContent = conversationHistory
		.map((message) => {
			const role = message.role === "user" ? "**User:**" : "**Assistant:**"
			const content = Array.isArray(message.content)
				? message.content.map((block) => formatContentBlockToMarkdown(block)).join("\n")
				: message.content
			return `${role}\n\n${content}\n\n`
		})
		.join("---\n\n")

	// Prompt user for save location
	const saveResponse = await HostProvider.window.showSaveDialog({
		options: {
			filters: { Markdown: { extensions: ["md"] } },
			defaultPath: path.join(os.homedir(), "Downloads", fileName),
		},
	})

	if (saveResponse.selectedPath) {
		try {
			// Write content to the selected location
			await writeFile(saveResponse.selectedPath, markdownContent)
			await openFile(saveResponse.selectedPath, false, true)
		} catch (error) {
			await HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to save markdown file: ${error instanceof Error ? error.message : String(error)}`,
			})
		}
	}
}

export function formatContentBlockToMarkdown(block: ContentBlock): string {
	switch (block.type) {
		case "text":
			return block.text
		case "image":
			return "[Image]"
		case "file":
			return `[File: ${block.path}]`
		case "thinking":
			return `[Thinking]\n${block.thinking}`
		case "redacted_thinking":
			return "[Thinking (Redacted)]"
		case "tool_use": {
			let input: string
			if (typeof block.input === "object" && block.input !== null) {
				input = Object.entries(block.input)
					.map(([key, value]) => `${key.charAt(0).toUpperCase() + key.slice(1)}: ${formatValue(value)}`)
					.join("\n")
			} else {
				input = String(block.input)
			}
			return `[Tool Use: ${block.name}]\n${input}`
		}
		case "tool_result": {
			if (typeof block.content === "string") {
				return `[Tool${block.is_error ? " (Error)" : ""}]\n${block.content}`
			}
			if (Array.isArray(block.content)) {
				return `[Tool${block.is_error ? " (Error)" : ""}]\n${block.content
					.map((contentBlock) => formatContentBlockToMarkdown(contentBlock))
					.join("\n")}`
			}
			return `[Tool${block.is_error ? " (Error)" : ""}]`
		}
		default:
			// Persisted tool results can carry untyped executor-output objects
			// (e.g. { query, result, success }); render them as JSON rather than
			// dropping the content.
			return formatValue(block)
	}
}

function formatValue(value: unknown): string {
	if (typeof value !== "object" || value === null) {
		return String(value)
	}
	try {
		return JSON.stringify(value, null, 2)
	} catch {
		return "[Unexpected content type]"
	}
}
