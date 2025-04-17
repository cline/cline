import fs from "fs/promises"
import path from "path"
import os from "os"
import { Anthropic } from "@anthropic-ai/sdk"

/**
 * Logs the complete query sent to the LLM provider to a file
 * @param systemPrompt The system prompt
 * @param messages The conversation history
 */
export async function logQuery(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): Promise<void> {
	try {
		// Format the query in a readable way
		let queryContent = `# System Prompt\n\n${systemPrompt}\n\n# Conversation History\n\n`

		// Add conversation history
		messages.forEach((message, index) => {
			queryContent += `## Message ${index + 1} (${message.role})\n\n`

			if (typeof message.content === "string") {
				queryContent += `${message.content}\n\n`
			} else if (Array.isArray(message.content)) {
				message.content.forEach((content, contentIndex) => {
					if (content.type === "text") {
						queryContent += `### Content ${contentIndex + 1} (text)\n\n${content.text}\n\n`
					} else if (content.type === "image") {
						queryContent += `### Content ${contentIndex + 1} (image)\n\n[Image: ${content.source.media_type}]\n\n`
					}
				})
			}
		})

		// Write to file
		const filePath = path.join(os.homedir(), "query.txt")
		await fs.writeFile(filePath, queryContent)

		console.log(`Query logged to ${filePath}`)
	} catch (error) {
		console.error("Error logging query:", error)
	}
}
