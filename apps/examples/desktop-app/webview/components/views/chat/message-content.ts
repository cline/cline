import { formatDisplayUserInput } from "@cline/shared/browser";
import type { ChatMessage } from "@/lib/chat-schema";
import { formatRunError } from "@/lib/run-error";

export function formatChatMessageContent(
	role: ChatMessage["role"],
	content: string,
	providerId?: string,
): string {
	const trimmed = content.trim();
	if (role === "error") return formatRunError(trimmed, providerId);
	return role === "user" ? formatDisplayUserInput(trimmed) : trimmed;
}
