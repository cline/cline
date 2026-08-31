import { formatDisplayUserInput } from "@cline/shared/browser";
import type { ChatMessageRole } from "./chat-message.js";

export function formatChatMessageContent(
	role: ChatMessageRole,
	content: string,
): string {
	const trimmed = content.trim();
	return role === "user" ? formatDisplayUserInput(trimmed) : trimmed;
}
