import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import { parseConnectorAuthPrompt } from "./connector-auth";

function makeToolMessage(payload: Record<string, unknown>): ChatMessage {
	return {
		id: "tool-1",
		sessionId: "session-1",
		role: "tool",
		content: JSON.stringify({
			toolName: "composio_manage_connections",
			input: { toolkits: ["gmail", "slack"] },
			...payload,
		}),
		createdAt: 1,
	} as ChatMessage;
}

const RESULT = {
	successful: true,
	data: {
		message: "1 active, 1 initiated",
		results: {
			gmail: {
				toolkit: "gmail",
				status: "initiated",
				redirect_url: "https://connect.composio.dev/link/lk_123",
			},
			slack: {
				toolkit: "slack",
				status: "active",
				connected_account_id: "ca_1",
			},
		},
	},
};

describe("parseConnectorAuthPrompt", () => {
	it("returns the Connect Link and connected toolkits", () => {
		expect(
			parseConnectorAuthPrompt(makeToolMessage({ result: RESULT })),
		).toEqual([
			{
				slug: "gmail",
				redirectUrl: "https://connect.composio.dev/link/lk_123",
			},
			{ slug: "slack" },
		]);
	});

	it("reads results replayed from history as text blocks", () => {
		const message = makeToolMessage({
			result: [{ type: "text", text: JSON.stringify(RESULT) }],
		});
		expect(parseConnectorAuthPrompt(message)?.[0]?.slug).toBe("gmail");
	});

	it("ignores results without a Connect Link", () => {
		const allActive = {
			data: { results: { slack: { toolkit: "slack", status: "active" } } },
		};
		expect(
			parseConnectorAuthPrompt(makeToolMessage({ result: allActive })),
		).toBeNull();
		expect(parseConnectorAuthPrompt(makeToolMessage({}))).toBeNull();
		expect(
			parseConnectorAuthPrompt(
				makeToolMessage({ result: "proxy failed", isError: true }),
			),
		).toBeNull();
	});

	it("rejects non-https links", () => {
		const result = {
			data: {
				results: {
					gmail: { status: "initiated", redirect_url: "javascript:alert(1)" },
				},
			},
		};
		expect(parseConnectorAuthPrompt(makeToolMessage({ result }))).toBeNull();
	});
});
