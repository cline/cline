import { formatDisplayUserInput } from "@cline/shared";
import type { AppView, ChatEntry } from "../types";

const APP_TITLE = "Cline";
const CHAT_TITLE_PREFIX = "> ";
const MAX_TERMINAL_TITLE_LENGTH = 80;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters from terminal titles is the purpose of this pattern
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/g;

function truncateTitle(title: string): string {
	if (title.length <= MAX_TERMINAL_TITLE_LENGTH) {
		return title;
	}
	return `${title.slice(0, MAX_TERMINAL_TITLE_LENGTH - 3).trimEnd()}...`;
}

function sanitizeTerminalTitleText(text: string): string {
	return text
		.replace(CONTROL_CHARACTER_PATTERN, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeChatTitleText(text: string): string {
	const formatted = formatDisplayUserInput(text);
	const firstLine = formatted.split("\n")[0] ?? formatted;
	return sanitizeTerminalTitleText(firstLine);
}

export function deriveTerminalTitle(input: {
	appView: AppView;
	entries: ChatEntry[];
	initialPrompt?: string;
}): string {
	if (input.appView !== "chat") {
		return APP_TITLE;
	}

	for (let index = input.entries.length - 1; index >= 0; index -= 1) {
		const entry = input.entries[index];
		if (entry?.kind !== "user_submitted" && entry?.kind !== "user") {
			continue;
		}
		const text = normalizeChatTitleText(entry.text);
		if (text) {
			return truncateTitle(`${CHAT_TITLE_PREFIX}${text}`);
		}
	}

	const initialPrompt = normalizeChatTitleText(input.initialPrompt ?? "");
	return initialPrompt
		? truncateTitle(`${CHAT_TITLE_PREFIX}${initialPrompt}`)
		: APP_TITLE;
}
