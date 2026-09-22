import {
	formatDisplayUserInput,
	type ProviderAuthInfo,
} from "@cline/shared/browser";
import type { ChatMessage } from "@/lib/chat-schema";
import { formatRunError } from "@/lib/run-error";

export function formatChatMessageContent(
	role: ChatMessage["role"],
	content: string,
	providerId?: string,
	providerAuth?: ProviderAuthInfo,
): string {
	const trimmed = content.trim();
	if (role === "error")
		return formatRunError(trimmed, providerId, providerAuth);
	return role === "user" ? formatDisplayUserInput(trimmed) : trimmed;
}
