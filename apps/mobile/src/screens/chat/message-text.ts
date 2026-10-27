import { userErrorMessage } from "@/error-message";
import type { SessionMessageView } from "@/session";
import { parseUserInputEnvelope } from "./user-text";

/** The same text feeds a bubble, its copy action, and conversation navigation. */
export function messageDisplayText(message: SessionMessageView): string {
	if (message.hidden) return "";
	const raw = message.blocks
		.flatMap((block) => (block.kind === "text" ? [block.text] : []))
		.join("\n\n");
	if (message.displayRole === "error")
		return userErrorMessage(raw, "Cline couldn't finish this turn. Try again.");
	if (message.role !== "user") return raw;
	const envelope = parseUserInputEnvelope(raw);
	if (envelope.unwrapped) return envelope.text;
	const command =
		/^<user_command\b[^>]*\bslash="([\w-]+)"[^>]*>([\s\S]*)<\/user_command>$/i.exec(
			raw.trim(),
		);
	if (!command) return raw;
	const slash = command[1] ?? "";
	let body = (command[2] ?? "").trim();
	const teamPrefix = "spawn a team of agents for the following task:";
	if (
		slash.toLowerCase() === "team" &&
		body.toLowerCase().startsWith(teamPrefix)
	)
		body = body.slice(teamPrefix.length).trim();
	return `/${slash}${body ? ` ${body}` : ""}`;
}

export const messageCopyText = messageDisplayText;

export function visibleTranscriptMessages(
	messages: readonly SessionMessageView[],
): SessionMessageView[] {
	return messages.filter((message) => !message.hidden);
}
