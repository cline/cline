import { SYSTEM_CONTENT_MARKERS, USER_CONTENT_TAGS } from "@shared/messages/constants"
import type { ClineContent } from "@shared/messages/content"

/**
 * Extracts the actual user input from content blocks, stripping system-added wrappers
 * and metadata. This ensures consistent prompt values across different scenarios
 * (new task, resume task, feedback after completion).
 *
 * @param userContent Array of content blocks that may contain user input
 * @returns Extracted user prompt text, or empty string if no user input found
 */
export function extractUserPromptFromContent(userContent: ClineContent[]): string {
	const extractedTexts: string[] = []

	for (const block of userContent) {
		if (block.type === "image") {
			// Preserve images as placeholders
			extractedTexts.push("[IMAGE]")
			continue
		}

		if (block.type !== "text") {
			continue
		}

		const text = block.text

		// Check if this block contains system-generated content that should be excluded
		const isSystemContent = SYSTEM_CONTENT_MARKERS.some((marker) => text.includes(marker))
		if (isSystemContent) {
			continue
		}

		// Check if block contains user content tags (case-insensitive)
		const textLower = text.toLowerCase()
		const hasUserTag = USER_CONTENT_TAGS.some((tag) => textLower.includes(tag.toLowerCase()))

		if (hasUserTag) {
			// Extract content from within known user content tags
			const extracted = extractFromUserContentTags(text, USER_CONTENT_TAGS)
			if (extracted) {
				extractedTexts.push(extracted)
			}
		} else {
			// This might be plain user text without tags - include it
			// but only if it's not empty after trimming
			const trimmed = text.trim()
			if (trimmed) {
				extractedTexts.push(trimmed)
			}
		}
	}

	return extractedTexts.join("\n\n").trim()
}

/**
 * Extracts text content from within known user content XML tags.
 * Handles tags like <task>, <feedback>, <answer>, <user_message>.
 *
 * @param text Text potentially containing user content tags
 * @param tags Array of tag names to extract from
 * @returns Extracted content or empty string
 */
function extractFromUserContentTags(text: string, tags: readonly string[]): string {
	const results: string[] = []

	for (const tag of tags) {
		// Create regex to match opening and closing tags (case-insensitive)
		// e.g., <task>content</task>, <TASK>content</TASK>, or <Task>content</Task>
		const tagName = tag.replace(/[<>]/g, "")
		const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "gi")

		let match: RegExpExecArray | null
		while ((match = regex.exec(text)) !== null) {
			const content = match[1].trim()
			if (content) {
				results.push(content)
			}
		}
	}

	return results.join("\n\n")
}
