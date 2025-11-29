import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import type { ClineContent } from "@shared/messages/content"

/**
 * Builds an array of ClineContent blocks from user feedback inputs.
 * This ensures consistent formatting across all user feedback scenarios:
 * - Task resumption with feedback
 * - Post-completion feedback
 *
 * @param text Optional feedback text from user
 * @param images Optional array of base64 image data
 * @param files Optional array of file paths to include
 * @returns Array of ClineContent blocks ready for hook processing (may be empty if no content provided)
 */
export async function buildUserFeedbackContent(text?: string, images?: string[], files?: string[]): Promise<ClineContent[]> {
	const content: ClineContent[] = []

	if (text) {
		content.push({
			type: "text",
			text: `<feedback>\n${text}\n</feedback>`,
		})
	}

	if (images && images.length > 0) {
		content.push(...formatResponse.imageBlocks(images))
	}

	if (files && files.length > 0) {
		const fileContentString = await processFilesIntoText(files)
		if (fileContentString) {
			content.push({
				type: "text",
				text: fileContentString,
			})
		}
	}

	return content
}
