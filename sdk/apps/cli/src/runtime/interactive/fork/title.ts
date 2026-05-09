import {
	formatDisplayUserInput,
	type Message,
	normalizeUserInput,
} from "@clinebot/shared";

const FORK_TITLE_SUFFIX = " (fork)";
const MAX_FORK_TITLE_LENGTH = 120;

function normalizeForkTitleText(value: string | undefined): string | undefined {
	const normalized = normalizeUserInput(formatDisplayUserInput(value))
		.replace(/\s+/g, " ")
		.trim();
	return normalized || undefined;
}

function truncateForForkSuffix(base: string): string {
	const maxBaseLength = MAX_FORK_TITLE_LENGTH - FORK_TITLE_SUFFIX.length;
	if (base.length <= maxBaseLength) {
		return base;
	}
	return base.slice(0, maxBaseLength).trimEnd();
}

function extractMessageText(message: Message): string | undefined {
	if (typeof message.content === "string") {
		return message.content;
	}
	const parts: string[] = [];
	for (const block of message.content) {
		if (block.type === "text") {
			parts.push(block.text);
		}
	}
	return parts.join("\n").trim() || undefined;
}

function inferForkTitleFromMessages(messages: Message[]): string | undefined {
	for (const role of ["user", "assistant"] as const) {
		for (const message of messages) {
			if (message.role !== role) {
				continue;
			}
			const text = extractMessageText(message);
			const normalized = normalizeForkTitleText(text);
			if (normalized) {
				return normalized;
			}
		}
	}
	return undefined;
}

export function deriveForkSessionTitle(input: {
	sourceTitle?: string | null;
	sourcePrompt?: string | null;
	messages: Message[];
}): string {
	const base =
		normalizeForkTitleText(input.sourceTitle ?? undefined) ??
		normalizeForkTitleText(input.sourcePrompt ?? undefined) ??
		inferForkTitleFromMessages(input.messages) ??
		"Untitled";
	return `${truncateForForkSuffix(base)}${FORK_TITLE_SUFFIX}`;
}
