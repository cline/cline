import type { SessionRecord as HubSessionRecord } from "@clinebot/shared";
import { readPersistedMessagesFile } from "../../runtime/host/runtime-host-support";

function extractAssistantText(content: unknown): string | undefined {
	if (typeof content === "string") {
		const trimmed = content.trim();
		return trimmed || undefined;
	}
	if (!Array.isArray(content)) {
		return undefined;
	}
	const text = content
		.map((part) => {
			if (
				part &&
				typeof part === "object" &&
				"type" in part &&
				(part as { type?: unknown }).type === "text" &&
				"text" in part &&
				typeof (part as { text?: unknown }).text === "string"
			) {
				return (part as { text: string }).text.trim();
			}
			return "";
		})
		.filter(Boolean)
		.join("\n")
		.trim();
	return text || undefined;
}

const MAX_NOTIFICATION_BODY_BYTES = 120;
const NOTIFICATION_BODY_ELLIPSIS = "...";

export function truncateNotificationBody(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return "";
	}
	if (Buffer.byteLength(trimmed, "utf8") <= MAX_NOTIFICATION_BODY_BYTES) {
		return trimmed;
	}
	const budget =
		MAX_NOTIFICATION_BODY_BYTES -
		Buffer.byteLength(NOTIFICATION_BODY_ELLIPSIS, "utf8");
	if (budget <= 0) {
		return NOTIFICATION_BODY_ELLIPSIS;
	}
	let truncated = "";
	for (const char of trimmed) {
		if (Buffer.byteLength(truncated + char, "utf8") > budget) {
			break;
		}
		truncated += char;
	}
	return `${truncated}${NOTIFICATION_BODY_ELLIPSIS}`;
}

export async function buildCompletionNotification(
	session: HubSessionRecord | undefined,
): Promise<{
	title: string;
	body: string;
	severity: "info";
}> {
	const sessionId = session?.sessionId?.trim() || "unknown";
	const messagesPath =
		typeof session?.metadata?.messagesPath === "string"
			? session.metadata.messagesPath
			: undefined;
	const messages = await readPersistedMessagesFile(messagesPath);
	const latestAssistantText = [...messages]
		.reverse()
		.find((message) => message.role === "assistant");
	const assistantReply = latestAssistantText
		? extractAssistantText(latestAssistantText.content)
		: undefined;
	const workspaceRoot = session?.workspaceRoot?.trim() || "workspace";
	const fallback =
		typeof session?.metadata?.prompt === "string"
			? session.metadata.prompt.trim()
			: workspaceRoot;
	return {
		title: `Task completed (${sessionId})`,
		body: truncateNotificationBody(
			assistantReply && assistantReply.length > 0
				? assistantReply
				: fallback.length > 0
					? fallback
					: workspaceRoot,
		),
		severity: "info",
	};
}
