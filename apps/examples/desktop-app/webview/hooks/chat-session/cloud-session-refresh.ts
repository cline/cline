import type { CloudPassiveReadResult } from "@cline/core/cloud";
import type { ChatMessage } from "@/lib/chat-schema";
import { desktopClient } from "@/lib/desktop-client";

export async function refreshCloudSession(args: {
	environmentId: string;
	sessionId: string;
	maxMessages: number;
}): Promise<CloudPassiveReadResult<ChatMessage> | { kind: "blocked" }> {
	try {
		return await desktopClient.invoke<CloudPassiveReadResult<ChatMessage>>(
			"read_cloud_session_without_resuming",
			args,
		);
	} catch (error) {
		// An older cloud host must not fall back to a read that can wake it.
		const message = error instanceof Error ? error.message : String(error);
		if (
			message.includes("Unknown cloud operation: readMessagesWithoutResuming")
		)
			return { kind: "blocked" };
		return { kind: "deferred" };
	}
}
