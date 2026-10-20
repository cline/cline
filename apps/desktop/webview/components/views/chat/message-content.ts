import {
	formatDisplayUserInput,
	type ProviderAuthInfo,
} from "@cline/shared/browser";
import type { ChatMessage } from "@/lib/chat-schema";
import { formatRunError, HUB_INTERRUPTED_MESSAGE_KIND } from "@/lib/run-error";

export function formatChatMessageContent(
	role: ChatMessage["role"],
	content: string,
	providerId?: string,
	providerAuth?: ProviderAuthInfo,
	messageKind?: string,
): string {
	const trimmed = content.trim();
	if (role === "error" && messageKind === HUB_INTERRUPTED_MESSAGE_KIND)
		return trimmed;
	if (role === "error")
		return formatRunError(trimmed, providerId, providerAuth);
	return role === "user" ? formatDisplayUserInput(trimmed) : trimmed;
}
