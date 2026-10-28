import type { CloudPassiveReadResult } from "@cline/core/cloud";
import type { ChatMessage } from "@/lib/chat-schema";
import { parseCloudSessionError } from "@/lib/cloud-session-error";
import { desktopClient } from "@/lib/desktop-client";

export async function refreshCloudSession(args: {
	environmentId: string;
	sessionId: string;
	maxMessages: number;
}): Promise<CloudPassiveReadResult<ChatMessage> | { kind: "blocked" }> {
	try {
		return await desktopClient.invoke<CloudPassiveReadResult<ChatMessage>>(
			"read_cloud_session_if_awake",
			args,
		);
	} catch (error) {
		// An older cloud host must not fall back to a read that can wake it.
		const message = error instanceof Error ? error.message : String(error);
		const code = parseCloudSessionError(message)?.code;
		if (
			code === "authentication_required" ||
			code === "session_not_found" ||
			message.includes("Unknown cloud operation: readMessagesIfAwake")
		)
			return { kind: "blocked" };
		return { kind: "deferred" };
	}
}
