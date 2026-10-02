import {
	extractOutputText,
	normalizeToolName,
} from "@cline/ui/components/agent-chat/tool-summary";
import type { ChatMessage } from "@/lib/chat-schema";
import { parseToolPayload } from "./tool-summaries";

/**
 * The agent asks the user to connect an app through the
 * `composio_manage_connections` connector tool (core's composio extension).
 * For a toolkit that is not connected yet, Composio answers with a hosted
 * Connect Link per toolkit:
 *
 *   { data: { results: { gmail: { toolkit, status: "initiated", redirect_url } } } }
 *
 * The chat renders those as connector cards instead of a raw tool row, so
 * this module pulls the links out of the tool message.
 */

export const CONNECTOR_MANAGE_TOOL_NAME = "composio_manage_connections";

export type ConnectorLink = {
	toolkit: string;
	redirectUrl: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function findResults(
	value: unknown,
	depth = 0,
): Record<string, unknown> | null {
	if (!isRecord(value) || depth > 3) return null;
	if (isRecord(value.results)) return value.results;
	// The connectors proxy and Composio each wrap their payload in `data`.
	return findResults(value.data, depth + 1);
}

/** Connect Links carried by a `composio_manage_connections` tool message,
 * in result order; empty for every other message. */
export function extractConnectorLinks(message: ChatMessage): ConnectorLink[] {
	if (message.role !== "tool") return [];
	const metaToolName = message.meta?.toolName;
	if (
		metaToolName &&
		normalizeToolName(metaToolName) !== CONNECTOR_MANAGE_TOOL_NAME
	) {
		return [];
	}
	const payload = parseToolPayload(message.content);
	if (
		!payload ||
		payload.isError ||
		payload.result == null ||
		normalizeToolName(payload.toolName ?? metaToolName ?? "") !==
			CONNECTOR_MANAGE_TOOL_NAME
	) {
		return [];
	}
	let result: unknown = payload.result;
	if (!isRecord(result)) {
		// Strings and content-block arrays (history) carry the JSON as text.
		try {
			const text = extractOutputText(result);
			result = text ? (JSON.parse(text) as unknown) : null;
		} catch {
			return [];
		}
	}
	const results = findResults(result);
	if (!results) return [];
	const links: ConnectorLink[] = [];
	for (const [key, entry] of Object.entries(results)) {
		if (!isRecord(entry)) continue;
		const redirectUrl = entry.redirect_url;
		if (typeof redirectUrl !== "string" || !/^https?:\/\//i.test(redirectUrl)) {
			continue;
		}
		const toolkit = (
			typeof entry.toolkit === "string" && entry.toolkit ? entry.toolkit : key
		)
			.trim()
			.toLowerCase();
		if (toolkit) links.push({ toolkit, redirectUrl });
	}
	return links;
}
