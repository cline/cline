import { Anthropic } from "@anthropic-ai/sdk"
import { writeFile } from "@utils/fs"
import os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import type { HistoryItem } from "@/shared/HistoryItem"
import { ShowMessageType } from "@/shared/proto/host/window"
import { openFile } from "./open-file"

export async function downloadTask(historyItem: HistoryItem, conversationHistory: Anthropic.MessageParam[]) {
	const dateTs = historyItem.ts
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

	// Generate metadata header
	const totalTokens = historyItem.tokensIn + historyItem.tokensOut
	const cacheTokens = (historyItem.cacheWrites || 0) + (historyItem.cacheReads || 0)
	const metadataHeader = [
		`# Task Metadata`,
		``,
		`**Task:** ${historyItem.task || "Untitled Task"}`,
		`**Date:** ${date.toLocaleString("en-US", { dateStyle: "full", timeStyle: "long" })}`,
		historyItem.modelId ? `**Model:** ${historyItem.modelId}` : null,
		``,
		`## Token Usage`,
		``,
		`- **Input Tokens:** ${historyItem.tokensIn.toLocaleString()}`,
		`- **Output Tokens:** ${historyItem.tokensOut.toLocaleString()}`,
		`- **Total Tokens:** ${totalTokens.toLocaleString()}`,
		historyItem.cacheWrites ? `- **Cache Write Tokens:** ${historyItem.cacheWrites.toLocaleString()}` : null,
		historyItem.cacheReads ? `- **Cache Read Tokens:** ${historyItem.cacheReads.toLocaleString()}` : null,
		cacheTokens > 0 ? `- **Total Cache Tokens:** ${cacheTokens.toLocaleString()}` : null,
		``,
		`## Cost`,
		``,
		`- **Total Cost:** $${historyItem.totalCost.toFixed(4)}`,
		``,
		`---`,
		``,
		`# Conversation History`,
		``,
	]
		.filter((line) => line !== null)
		.join("\n")

	// Generate conversation markdown
	const conversationContent = conversationHistory
		.map((message) => {
			const role = message.role === "user" ? "**User:**" : "**Assistant:**"
			const content = Array.isArray(message.content)
				? message.content.map((block) => formatContentBlockToMarkdown(block)).join("\n")
				: message.content
			return `${role}\n\n${content}\n\n`
		})
		.join("---\n\n")

	// Combine metadata header with conversation
	const markdownContent = metadataHeader + conversationContent

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

/**
 * Formats a content block to markdown for display in API request messages.
 * Used by Task class to format user content for the api_req_started message.
 */
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
