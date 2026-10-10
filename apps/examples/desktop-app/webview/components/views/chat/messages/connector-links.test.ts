import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import { extractConnectorLinks } from "./connector-links";

const GMAIL_LINK = "https://connect.composio.dev/link/gmail-abc";

function toolMessage(
	payload: unknown,
	meta?: ChatMessage["meta"],
): ChatMessage {
	return {
		id: "t1",
		sessionId: "s1",
		role: "tool",
		content: typeof payload === "string" ? payload : JSON.stringify(payload),
		createdAt: 1,
		meta,
	} as ChatMessage;
}

const composioResult = {
	data: {
		message: "1 initiated, 1 active",
		results: {
			gmail: {
				toolkit: "gmail",
				status: "initiated",
				redirect_url: GMAIL_LINK,
				instruction: "Click the link to authenticate",
			},
			slack: {
				toolkit: "slack",
				status: "active",
				has_active_connection: true,
				connected_account_id: "ca_123",
			},
		},
	},
	successful: true,
};

describe("extractConnectorLinks", () => {
	it("returns the initiated toolkits' Connect Links from a structured result", () => {
		const links = extractConnectorLinks(
			toolMessage({
				toolName: "composio_manage_connections",
				input: { toolkits: ["gmail", "slack"] },
				result: composioResult,
			}),
		);
		expect(links).toEqual([{ toolkit: "gmail", redirectUrl: GMAIL_LINK }]);
	});

	it("unwraps the connectors proxy envelope and JSON-string results", () => {
		const links = extractConnectorLinks(
			toolMessage({
				toolName: "composio_manage_connections",
				result: JSON.stringify({ data: composioResult, success: true }),
			}),
		);
		expect(links).toEqual([{ toolkit: "gmail", redirectUrl: GMAIL_LINK }]);
	});

	it("reads content-block results from persisted history", () => {
		const links = extractConnectorLinks(
			toolMessage(
				{
					toolName: "composio_manage_connections",
					result: [{ type: "text", text: JSON.stringify(composioResult) }],
				},
				{ toolName: "composio_manage_connections" },
			),
		);
		expect(links).toEqual([{ toolkit: "gmail", redirectUrl: GMAIL_LINK }]);
	});

	it("falls back to the result key when an entry has no toolkit field", () => {
		const links = extractConnectorLinks(
			toolMessage({
				toolName: "composio_manage_connections",
				result: {
					data: { results: { GitHub: { redirect_url: "https://x.test/1" } } },
				},
			}),
		);
		expect(links).toEqual([
			{ toolkit: "github", redirectUrl: "https://x.test/1" },
		]);
	});

	it("ignores other tools, errors, pending calls, and non-http links", () => {
		expect(
			extractConnectorLinks(
				toolMessage({ toolName: "search", result: composioResult }),
			),
		).toEqual([]);
		expect(
			extractConnectorLinks(
				toolMessage({
					toolName: "composio_manage_connections",
					result: { error: "nope" },
					isError: true,
				}),
			),
		).toEqual([]);
		expect(
			extractConnectorLinks(
				toolMessage(
					{ toolName: "composio_manage_connections", input: {} },
					{ toolName: "composio_manage_connections" },
				),
			),
		).toEqual([]);
		expect(
			extractConnectorLinks(
				toolMessage({
					toolName: "composio_manage_connections",
					result: {
						data: {
							results: {
								gmail: { redirect_url: "javascript:alert(1)" },
							},
						},
					},
				}),
			),
		).toEqual([]);
		expect(
			extractConnectorLinks({
				id: "a",
				sessionId: "s1",
				role: "assistant",
				content: "hi",
				createdAt: 1,
			} as ChatMessage),
		).toEqual([]);
	});
});
