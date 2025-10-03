import { Anthropic } from "@anthropic-ai/sdk"
import { writeFile } from "@utils/fs"
import os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { openFile } from "./open-file"

export interface TaskUsageStats {
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
}

export async function downloadTask(dateTs: number, conversationHistory: Anthropic.MessageParam[], usageStats?: TaskUsageStats) {
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

	// Generate usage summary if stats are provided
	let usageSummary = ""
	if (usageStats) {
		const totalTokens =
			usageStats.tokensIn + usageStats.tokensOut + (usageStats.cacheWrites || 0) + (usageStats.cacheReads || 0)

		usageSummary = `# Task Usage Summary\n\n`
		usageSummary += `**Total Tokens:** ${totalTokens.toLocaleString()}\n`
		usageSummary += `- Input Tokens: ${usageStats.tokensIn.toLocaleString()}\n`
		usageSummary += `- Output Tokens: ${usageStats.tokensOut.toLocaleString()}\n`

		if (usageStats.cacheWrites && usageStats.cacheWrites > 0) {
			usageSummary += `- Cache Write Tokens: ${usageStats.cacheWrites.toLocaleString()}\n`
		}
		if (usageStats.cacheReads && usageStats.cacheReads > 0) {
			usageSummary += `- Cache Read Tokens: ${usageStats.cacheReads.toLocaleString()}\n`
		}

		usageSummary += `\n**Total Cost:** $${usageStats.totalCost.toFixed(4)}\n\n`
		usageSummary += `---\n\n`
	}

	// Generate conversation content
	const conversationContent = conversationHistory
		.map((message) => {
			const role = message.role === "user" ? "**User:**" : "**Assistant:**"
			const content = Array.isArray(message.content)
				? message.content.map((block) => formatContentBlockToMarkdown(block)).join("\n")
				: message.content
			return `${role}\n\n${content}\n\n`
		})
		.join("---\n\n")

	// Combine usage summary and conversation content
	const markdownContent = usageSummary + conversationContent

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

export function formatContentBlockToMarkdown(block: Anthropic.ContentBlockParam): string {
	switch (block.type) {
		case "text":
			return block.text
		case "image":
			return `[Image]`
		case "document":
			return `[Document]`
		case "tool_use":
			let input: string
			if (typeof block.input === "object" && block.input !== null) {
				input = Object.entries(block.input)
					.map(([key, value]) => `${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`)
					.join("\n")
			} else {
				input = String(block.input)
			}
			return `[Tool Use: ${block.name}]\n${input}`
		case "tool_result":
			if (typeof block.content === "string") {
				return `[Tool${block.is_error ? " (Error)" : ""}]\n${block.content}`
			} else if (Array.isArray(block.content)) {
				return `[Tool${block.is_error ? " (Error)" : ""}]\n${block.content
					.map((contentBlock) => formatContentBlockToMarkdown(contentBlock))
					.join("\n")}`
			} else {
				return `[Tool${block.is_error ? " (Error)" : ""}]`
			}
		default:
			return "[Unexpected content type]"
	}
}
