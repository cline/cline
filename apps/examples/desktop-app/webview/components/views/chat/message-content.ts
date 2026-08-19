import { formatDisplayUserInput } from "@cline/shared/browser";
import type { ChatMessage } from "@/lib/chat-schema";

const MONITOR_RESUME_MARKER =
	/^\[monitor mon_\d+ stopped because session resumed\]$/;

/**
 * The persisted notice keeps its <system-reminder> envelope and bracketed
 * machine markers for the agent and the monitor parsers. Rendering them
 * through markdown mangles the text, so only the human sentence displays.
 */
function formatMonitorResumeNotice(content: string): string {
	return content
		.replace(/<\/?system-reminder>/g, "")
		.split("\n")
		.filter((line) => !MONITOR_RESUME_MARKER.test(line.trim()))
		.join("\n")
		.trim();
}

export function formatChatMessageContent(
	role: ChatMessage["role"],
	content: string,
	messageKind?: string,
): string {
	const trimmed = content.trim();
	if (role === "user") {
		return formatDisplayUserInput(trimmed);
	}
	if (messageKind === "monitor_resume_notice") {
		return formatMonitorResumeNotice(trimmed);
	}
	return trimmed;
}
