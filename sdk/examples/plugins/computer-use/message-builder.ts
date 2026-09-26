import type { Message, ToolResultContent } from "@cline/core";

const COMPUTER_RESULT_NAMES = new Set(["computer", "computer_poll"]);
const SUPERSEDED_SCREENSHOT =
	"[older computer screenshot omitted; superseded by the current screen]";

function isImage(
	value: unknown,
): value is { type: "image"; data: string; mediaType: string } {
	return (
		value !== null &&
		typeof value === "object" &&
		(value as { type?: unknown }).type === "image" &&
		typeof (value as { data?: unknown }).data === "string" &&
		typeof (value as { mediaType?: unknown }).mediaType === "string"
	);
}

/** Keep only the most recent screenshot returned by this plugin. */
export function projectComputerScreenshots(messages: Message[]): Message[] {
	let latest: { message: number; block: number; entry: number } | undefined;
	for (let message = 0; message < messages.length; message++) {
		const content = messages[message]?.content;
		if (!Array.isArray(content)) continue;
		for (let block = 0; block < content.length; block++) {
			const result = content[block];
			if (
				result?.type !== "tool_result" ||
				!COMPUTER_RESULT_NAMES.has(result.name) ||
				!Array.isArray(result.content)
			) {
				continue;
			}
			for (let entry = 0; entry < result.content.length; entry++) {
				if (isImage(result.content[entry])) latest = { message, block, entry };
			}
		}
	}
	if (!latest) return messages;

	return messages.map((message, messageIndex) => {
		if (!Array.isArray(message.content)) return message;
		let contentChanged = false;
		const content = message.content.map((block, blockIndex) => {
			if (
				block.type !== "tool_result" ||
				!COMPUTER_RESULT_NAMES.has(block.name) ||
				!Array.isArray(block.content)
			) {
				return block;
			}
			let blockChanged = false;
			const resultContent = block.content.map((entry, entryIndex) => {
				if (
					!isImage(entry) ||
					(messageIndex === latest.message &&
						blockIndex === latest.block &&
						entryIndex === latest.entry)
				) {
					return entry;
				}
				blockChanged = true;
				return { type: "text" as const, text: SUPERSEDED_SCREENSHOT };
			});
			if (!blockChanged) return block;
			contentChanged = true;
			return {
				...block,
				content: resultContent as ToolResultContent["content"],
			};
		});
		if (!contentChanged) return message;
		return { ...message, content };
	});
}
