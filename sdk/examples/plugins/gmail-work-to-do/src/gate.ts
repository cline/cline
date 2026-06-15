import type { BasicLogger } from "@cline/core";
import { advanceStateForProcessedMessages, selectNewMessages } from "./dedupe";
import type { GmailFetchedMessage } from "./gmail";
import { type GmailWorkState, readState, writeState } from "./state";

export interface GmailGateOptions {
	logger?: BasicLogger;
	readState?: () => GmailWorkState;
	writeState?: (state: GmailWorkState) => void;
	fetchMessages?: (input: {
		query?: string;
		labelId?: string;
		labelName?: string;
		maxResults: number;
	}) => Promise<GmailFetchedMessage[]>;
}

interface GmailWorkSource {
	description: string;
	query?: string;
	labelId?: string;
	labelName?: string;
}

interface HandoffMessage {
	id: string;
	role: "user";
	createdAt: number;
	content: Array<{ type: "text"; text: string }>;
}

export interface GmailGateResult {
	stop?: boolean;
	reason?: string;
	appendMessages?: HandoffMessage[];
}

function env(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

function maxResultsFromEnv(): number {
	const parsed = Number(env("GMAIL_MAX_RESULTS") ?? "25");
	return Number.isFinite(parsed) && parsed > 0
		? Math.min(Math.trunc(parsed), 100)
		: 25;
}

function resolveWorkSource(): GmailWorkSource {
	const query = env("GMAIL_SEARCH_QUERY");
	const labelId = env("GMAIL_LABEL_ID");
	const labelName = env("GMAIL_LABEL");
	if (query) {
		return { description: `query:${query}`, query };
	}
	if (labelId) {
		return { description: `label:${labelId}`, labelId };
	}
	if (labelName) {
		return { description: `label:${labelName}`, labelName };
	}
	throw new Error(
		"Set GMAIL_SEARCH_QUERY, GMAIL_LABEL_ID, or GMAIL_LABEL to use the Gmail work-to-do gate",
	);
}

function truncate(value: string | undefined, max: number): string | undefined {
	if (!value) return undefined;
	const normalized = value.replace(/\s+/g, " ").trim();
	if (!normalized) return undefined;
	return normalized.length > max
		? `${normalized.slice(0, max - 3).trimEnd()}...`
		: normalized;
}

export function formatMessagesForAgent(
	messages: readonly GmailFetchedMessage[],
): string {
	return [
		`Gmail work-to-do gate found ${messages.length} new matching message(s).`,
		"Process these messages as the work for this run:",
		...messages.map((message, index) =>
			[
				`## Message ${index + 1}`,
				`ID: ${message.id}`,
				message.threadId ? `Thread ID: ${message.threadId}` : undefined,
				`Internal Date: ${message.internalDate}`,
				message.date ? `Date: ${message.date}` : undefined,
				message.from ? `From: ${message.from}` : undefined,
				message.to ? `To: ${message.to}` : undefined,
				message.subject ? `Subject: ${message.subject}` : undefined,
				message.snippet ? `Snippet: ${message.snippet}` : undefined,
				message.bodyText
					? `Body:\n${truncate(message.bodyText, 6000)}`
					: message.bodyHtml
						? `HTML Body:\n${truncate(message.bodyHtml, 6000)}`
						: undefined,
			]
				.filter(Boolean)
				.join("\n"),
		),
	].join("\n\n");
}

function makeHandoffMessage(
	messages: readonly GmailFetchedMessage[],
): HandoffMessage {
	return {
		id: `msg_gmail_work_${Date.now()}`,
		role: "user",
		createdAt: Date.now(),
		content: [{ type: "text", text: formatMessagesForAgent(messages) }],
	};
}

export async function runGmailWorkGate(
	options: GmailGateOptions = {},
): Promise<GmailGateResult> {
	const logger = options.logger;
	const source = resolveWorkSource();

	const fetchMessages =
		options.fetchMessages ??
		(async ({ query, labelId, labelName, maxResults }) => {
			const { createGmailClient, resolveGmailLabelId, searchAndFetchMessages } =
				await import("./gmail");
			const gmail = await createGmailClient();
			const resolvedLabelId = labelName
				? await resolveGmailLabelId({ gmail, labelName })
				: labelId;
			return searchAndFetchMessages({
				gmail,
				query,
				labelId: resolvedLabelId,
				maxResults,
			});
		});
	const state = options.readState?.() ?? readState();
	const messages = await fetchMessages({
		query: source.query,
		labelId: source.labelId,
		labelName: source.labelName,
		maxResults: maxResultsFromEnv(),
	});
	const newMessages = selectNewMessages(messages, state);

	if (newMessages.length === 0) {
		logger?.log("Gmail work-to-do gate: no new mail, exiting", {
			severity: "info",
			source: source.description,
			matchedCount: messages.length,
		});
		return { stop: true, reason: "no new mail, exiting" };
	}

	const nextState = advanceStateForProcessedMessages(state, newMessages);
	if (options.writeState) {
		options.writeState(nextState);
	} else {
		writeState(nextState);
	}
	logger?.log("Gmail work-to-do gate: new mail found", {
		severity: "info",
		source: source.description,
		newCount: newMessages.length,
		messageIds: newMessages.map((message) => message.id),
	});

	return {
		reason: `found ${newMessages.length} new Gmail message(s)`,
		appendMessages: [makeHandoffMessage(newMessages)],
	};
}
