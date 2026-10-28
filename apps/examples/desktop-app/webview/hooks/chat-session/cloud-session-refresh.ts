import type { ChatMessage } from "@/lib/chat-schema";
import { desktopClient } from "@/lib/desktop-client";

type CloudSessionRefresh =
	| { kind: "stale" }
	| { kind: "suspended" }
	| {
			kind: "refreshed";
			messages: ChatMessage[] | null;
			record: { status?: string } | null;
	  };

export async function refreshCloudSession({
	environmentId,
	sessionId,
	maxMessages,
	isCurrent,
}: {
	environmentId: string;
	sessionId: string;
	maxMessages: number;
	isCurrent: () => boolean;
}): Promise<CloudSessionRefresh> {
	const record = await desktopClient
		.invoke<{ status?: string } | null>("get_discovered_session", {
			environmentId,
			sessionId,
		})
		.catch(() => null);
	if (!isCurrent()) return { kind: "stale" };
	// Reading cloud history can resume a suspended sandbox.
	if (record?.status?.trim() === "suspended") return { kind: "suspended" };
	const messages = await desktopClient
		.invoke<ChatMessage[]>("read_session_messages", {
			environmentId,
			sessionId,
			maxMessages,
		})
		.catch(() => null);
	return { kind: "refreshed", messages, record };
}
