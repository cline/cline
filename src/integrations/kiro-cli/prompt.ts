import type { ClineContent, ClineStorageMessage } from "@/shared/messages/content"

const stringifyContentBlock = (block: ClineContent): string => {
	switch (block.type) {
		case "text":
			return block.text
		case "image":
			return "[Image omitted: Kiro CLI MVP forwards text-only context]"
		case "document":
			return "[Document omitted: Kiro CLI MVP forwards text-only context]"
		case "tool_use":
			return `[Tool call ${block.name ?? "unknown"}: ${JSON.stringify(block.input ?? {})}]`
		case "tool_result":
			return `[Tool result: ${typeof block.content === "string" ? block.content : "[structured tool result]"}]`
		case "thinking":
			return `[Reasoning: ${block.thinking}]`
		case "redacted_thinking":
			return "[Redacted reasoning block]"
		default:
			return `[Unsupported block type: ${(block as { type?: string }).type ?? "unknown"}]`
	}
}

const stringifyMessage = (message: ClineStorageMessage): string => {
	if (typeof message.content === "string") {
		return message.content
	}

	return message.content.map(stringifyContentBlock).join("\n").trim()
}

export const buildKiroCliPrompt = (systemPrompt: string, messages: ClineStorageMessage[]): string => {
	const transcript = messages
		.map((message) => `${message.role.toUpperCase()}:\n${stringifyMessage(message)}`)
		.filter((entry) => entry.trim().length > 0)
		.join("\n\n")

	return [
		"System instructions:",
		systemPrompt.trim(),
		"",
		"Conversation transcript:",
		transcript || "USER:\n[No prior conversation transcript provided]",
		"",
		"Task:",
		"Respond to the latest user request using the transcript as context.",
	].join("\n")
}
