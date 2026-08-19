/**
 * Telegram Bot API adapter (Gateway RFC, Phase 6 V0): long-poll offsets
 * driven by the dedupe cursor, message normalization, bot-message
 * filtering, and the credential-holding reply port.
 */

import type {
	ConnectorDescriptor,
	NormalizedConnectorMessage,
} from "@cline/bot";
import { createBotId, createConnectorId } from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import type { ConnectorAdapterContext } from "./adapter";
import { TelegramConnectorAdapter } from "./telegram";

const DESCRIPTOR: ConnectorDescriptor = {
	connectorId: createConnectorId(),
	botId: createBotId(),
	kind: "telegram",
	name: "tg",
};

interface RecordedRequest {
	url: string;
	init?: RequestInit;
}

function fakeFetch(
	responder: (url: string, init?: RequestInit) => unknown,
	requests: RecordedRequest[] = [],
): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		requests.push({ url, init });
		const body = responder(url, init);
		return {
			ok: true,
			status: 200,
			json: async () => body,
		} as Response;
	}) as typeof fetch;
}

function createContext(options: {
	cursor?: string;
	onDeliver?: (message: NormalizedConnectorMessage, nextCursor: string) => void;
}): { context: ConnectorAdapterContext; controller: AbortController } {
	const controller = new AbortController();
	let cursor = options.cursor;
	const context: ConnectorAdapterContext = {
		descriptor: DESCRIPTOR,
		config: {},
		credential: "TEST_TOKEN",
		signal: controller.signal,
		cursor: () => cursor,
		deliver: (message, nextCursor) => {
			options.onDeliver?.(message, nextCursor);
			cursor = nextCursor;
		},
		commitCursor: (nextCursor) => {
			cursor = nextCursor;
		},
		log: () => {},
	};
	return { context, controller };
}

describe("telegram adapter", () => {
	it("polls from cursor+1, normalizes messages, and advances the cursor", async () => {
		const requests: RecordedRequest[] = [];
		const delivered: { message: NormalizedConnectorMessage; cursor: string }[] =
			[];
		const { context, controller } = createContext({
			cursor: "41",
			onDeliver: (message, cursor) => {
				delivered.push({ message, cursor });
				if (delivered.length === 2) {
					controller.abort();
				}
			},
		});
		const adapter = new TelegramConnectorAdapter({
			fetchImpl: fakeFetch((url) => {
				if (!url.includes("getUpdates")) {
					throw new Error(`unexpected ${url}`);
				}
				return {
					ok: true,
					result: [
						{
							update_id: 42,
							message: {
								message_id: 7,
								text: "hello",
								date: 1_700_000_000,
								from: { id: 99, username: "ada" },
								chat: { id: -100, type: "group", title: "Team" },
							},
						},
						{
							update_id: 43,
							// A bot's own message: normalized away, cursor still moves.
							message: {
								message_id: 8,
								text: "self",
								from: { id: 1, is_bot: true },
								chat: { id: -100 },
							},
						},
						{
							update_id: 44,
							message: {
								message_id: 9,
								text: "second",
								from: { id: 99, first_name: "Ada" },
								chat: { id: -100 },
							},
						},
					],
				};
			}, requests),
		});
		await adapter.run(context);

		// offset = cursor + 1, token in the path.
		expect(requests[0].url).toContain("/botTEST_TOKEN/getUpdates");
		expect(requests[0].url).toContain("offset=42");

		expect(delivered).toHaveLength(2);
		expect(delivered[0].message).toMatchObject({
			connectorId: DESCRIPTOR.connectorId,
			externalAccountId: "99",
			externalConversationId: "-100",
			externalMessageId: "42",
			text: "hello",
			senderDisplay: "ada",
			sentAt: 1_700_000_000_000,
		});
		expect(delivered[0].message.metadata).toMatchObject({
			platform: "telegram",
			chatType: "group",
			chatTitle: "Team",
		});
		expect(delivered[0].cursor).toBe("42");
		// The bot message advanced the cursor without delivering.
		expect(delivered[1].message.externalMessageId).toBe("44");
		expect(context.cursor()).toBe("44");
	});

	it("fails fast without a credential", async () => {
		const { context } = createContext({});
		(context as { credential?: string }).credential = undefined;
		const adapter = new TelegramConnectorAdapter({
			fetchImpl: fakeFetch(() => ({ ok: true, result: [] })),
		});
		await expect(adapter.run(context)).rejects.toThrow(/no bot token/);
	});

	it("replies through sendMessage with the token kept inside the port", async () => {
		const requests: RecordedRequest[] = [];
		const adapter = new TelegramConnectorAdapter({
			fetchImpl: fakeFetch(() => ({ ok: true, result: {} }), requests),
		});
		const port = adapter.createReplyPort({}, "TEST_TOKEN");
		await port.reply(
			{ externalAccountId: "99", externalConversationId: "-100" },
			"done",
		);
		expect(requests[0].url).toContain("/botTEST_TOKEN/sendMessage");
		expect(JSON.parse(String(requests[0].init?.body))).toEqual({
			chat_id: "-100",
			text: "done",
		});
	});
});
