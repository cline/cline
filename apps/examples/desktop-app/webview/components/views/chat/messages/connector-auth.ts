import type { ChatMessage } from "@/lib/chat-schema";
import { isComposioToolkitSlug } from "@/lib/composio-types";
import { normalizeDisplayValue, parseToolPayload } from "./tool-summaries";

export const MANAGE_CONNECTIONS_TOOL_NAME = "composio_manage_connections";

export type ConnectorAuthToolkit = {
	slug: string;
	/** Present while the user still has to authorize the toolkit. */
	redirectUrl?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

/** Tool results replayed from history arrive as text content blocks. */
function unwrapToolResult(value: unknown): unknown {
	if (Array.isArray(value)) {
		const text = value
			.map((block) => {
				const record = asRecord(block);
				return record?.type === "text" && typeof record.text === "string"
					? record.text
					: "";
			})
			.join("");
		return text ? normalizeDisplayValue(text) : value;
	}
	return normalizeDisplayValue(value);
}

/**
 * The toolkits a `composio_manage_connections` call asks the user to connect,
 * or null when the result carries no Connect Link (still running, failed, or
 * every toolkit was already connected).
 *
 * Composio returns `{ data: { results: { [slug]: { status, redirect_url } } } }`:
 * `initiated` entries carry the Connect Link, `active` ones are connected.
 */
export function parseConnectorAuthPrompt(
	message: ChatMessage,
): ConnectorAuthToolkit[] | null {
	if (message.role !== "tool") return null;
	const payload = parseToolPayload(message.content);
	const toolName = message.meta?.toolName || payload?.toolName;
	if (
		toolName !== MANAGE_CONNECTIONS_TOOL_NAME ||
		!payload ||
		payload.isError
	) {
		return null;
	}
	const result = asRecord(unwrapToolResult(payload.result));
	const results = asRecord(asRecord(result?.data)?.results);
	if (!results) return null;
	const toolkits: ConnectorAuthToolkit[] = [];
	for (const [key, value] of Object.entries(results)) {
		const entry = asRecord(value);
		const slug = (
			typeof entry?.toolkit === "string" ? entry.toolkit : key
		).toLowerCase();
		if (!entry || !isComposioToolkitSlug(slug)) continue;
		const status = String(entry.status ?? "").toLowerCase();
		const redirectUrl =
			typeof entry.redirect_url === "string" ? entry.redirect_url.trim() : "";
		if (redirectUrl.startsWith("https://")) {
			toolkits.push({ slug, redirectUrl });
		} else if (status === "active") {
			toolkits.push({ slug });
		}
	}
	return toolkits.some((toolkit) => toolkit.redirectUrl) ? toolkits : null;
}
