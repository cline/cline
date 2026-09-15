import { formatDisplayUserInput } from "@cline/shared/browser";
import type { ChatMessage } from "@/lib/chat-schema";

export function formatChatMessageContent(
	role: ChatMessage["role"],
	content: string,
): string {
	const trimmed = content.trim();
	return role === "user" ? formatDisplayUserInput(trimmed) : trimmed;
}
