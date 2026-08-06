import type {
	ClineContent,
	ClineStorageMessage,
	ClineTextContentBlock,
	ClineUserToolResultContentBlock,
} from "./content";

export const IMAGE_UNSUPPORTED_PLACEHOLDER =
	"[Image attached — this model cannot view images]";

function replaceImage(block: ClineContent): ClineContent {
	if (block.type === "image") {
		return { type: "text", text: IMAGE_UNSUPPORTED_PLACEHOLDER };
	}
	if (block.type === "tool_result" && Array.isArray(block.content)) {
		return {
			...block,
			content: block.content.map((part) =>
				part.type === "image"
					? ({
							type: "text",
							text: IMAGE_UNSUPPORTED_PLACEHOLDER,
						} satisfies ClineTextContentBlock)
					: part,
			),
		} satisfies ClineUserToolResultContentBlock;
	}
	return block;
}

/**
 * Builds a provider request history without image blocks for text-only models.
 * The stored history remains unchanged, so switching back to a vision model
 * restores the original images.
 */
export function prepareMessagesForImageSupport(
	messages: ClineStorageMessage[],
	supportsImages: boolean | undefined,
): ClineStorageMessage[] {
	if (supportsImages === true) {
		return messages;
	}
	return messages.map((message) =>
		typeof message.content === "string"
			? message
			: { ...message, content: message.content.map(replaceImage) },
	);
}
