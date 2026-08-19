import type { SentMessage, Thread } from "chat";
import { describe, expect, it, vi } from "vitest";
import type { CliLoggerAdapter } from "../../logging/adapter";
import type { ConnectorThreadState } from "../thread-bindings";
import {
	buildTelegramFormattedPayload,
	buildTelegramFormattedPayloads,
	parseTelegramThreadId,
	postTelegramFormattedReply,
} from "./telegram-format";

function createLogger() {
	return {
		core: {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		},
	} as unknown as CliLoggerAdapter;
}

function createThread(id = "telegram:123") {
	const posts: unknown[] = [];
	const thread = {
		id,
		post: vi.fn(async (message: unknown) => {
			posts.push(message);
			return {} as SentMessage;
		}),
	} as unknown as Thread<ConnectorThreadState>;
	return { thread, posts };
}

describe("telegram formatted replies", () => {
	it("parses Telegram thread IDs with optional topic IDs", () => {
		expect(parseTelegramThreadId("telegram:123")).toEqual({ chatId: "123" });
		expect(parseTelegramThreadId("telegram:-100123:7")).toEqual({
			chatId: "-100123",
			messageThreadId: 7,
		});
		expect(parseTelegramThreadId("123")).toEqual({ chatId: "123" });
	});

	it("builds entity payloads without Telegram parse_mode", () => {
		const payload = buildTelegramFormattedPayload(
			"telegram:123:9",
			"**Bold** and `code` plus [link](https://example.com)",
		);

		expect(payload).toEqual({
			chat_id: "123",
			message_thread_id: 9,
			text: "Bold and code plus link",
			link_preview_options: { is_disabled: true },
			entities: [
				{ type: "bold", offset: 0, length: 4 },
				{ type: "code", offset: 9, length: 4 },
				{
					type: "text_link",
					offset: 19,
					length: 4,
					url: "https://example.com",
				},
			],
		});
		expect(payload).not.toHaveProperty("parse_mode");
	});

	it("leaves malformed markdown as plain text instead of throwing", () => {
		const payload = buildTelegramFormattedPayload(
			"telegram:123",
			"Your repo is called **`",
		);

		expect(payload).toEqual({
			chat_id: "123",
			text: "Your repo is called **`",
			link_preview_options: { is_disabled: true },
		});
	});

	it("preserves fenced code as Telegram pre entities", () => {
		const payload = buildTelegramFormattedPayload(
			"telegram:123",
			"```ts\nconst x = 1\n```",
		);

		expect(payload).toEqual({
			chat_id: "123",
			text: "const x = 1",
			link_preview_options: { is_disabled: true },
			entities: [{ type: "pre", offset: 0, length: 11, language: "ts" }],
		});
	});

	it("chunks long formatted replies without dropping text", () => {
		const longText = `${"a".repeat(4096)}${"b".repeat(10)}`;
		const payloads = buildTelegramFormattedPayloads("telegram:123", longText);

		expect(payloads).toHaveLength(2);
		expect(payloads[0]?.text).toHaveLength(4096);
		expect(payloads[1]?.text).toBe("b".repeat(10));
		expect(payloads.map((payload) => payload.text).join("")).toBe(longText);
	});

	it("splits formatting entities across long reply chunks", () => {
		const payloads = buildTelegramFormattedPayloads(
			"telegram:123",
			`**${"a".repeat(4096)}${"b".repeat(10)}**`,
		);

		expect(payloads).toHaveLength(2);
		expect(payloads[0]?.entities).toEqual([
			{ type: "bold", offset: 0, length: 4096 },
		]);
		expect(payloads[1]?.entities).toEqual([
			{ type: "bold", offset: 0, length: 10 },
		]);
		expect(payloads.map((payload) => payload.text).join("")).toBe(
			`${"a".repeat(4096)}${"b".repeat(10)}`,
		);
	});

	it("sends formatted replies directly through Telegram entities", async () => {
		const { thread } = createThread("telegram:123");
		const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
			expect(JSON.parse(String(init?.body))).toEqual({
				chat_id: "123",
				text: "Bold",
				link_preview_options: { is_disabled: true },
				entities: [{ type: "bold", offset: 0, length: 4 }],
			});
			return new Response(JSON.stringify({ ok: true, result: {} }), {
				status: 200,
			});
		});

		await postTelegramFormattedReply({
			thread,
			text: "**Bold**",
			botToken: "token",
			logger: createLogger(),
			fetchImpl,
		});

		expect(fetchImpl).toHaveBeenCalledWith(
			"https://api.telegram.org/bottoken/sendMessage",
			expect.objectContaining({
				method: "POST",
				headers: { "content-type": "application/json" },
			}),
		);
		expect(thread.post).not.toHaveBeenCalled();
	});

	it("sends long formatted replies as multiple Telegram messages", async () => {
		const { thread } = createThread("telegram:123");
		const text = `${"a".repeat(4096)}tail`;
		const fetchImpl = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
			return new Response(JSON.stringify({ ok: true, result: {} }), {
				status: 200,
			});
		});

		await postTelegramFormattedReply({
			thread,
			text,
			botToken: "token",
			logger: createLogger(),
			fetchImpl,
		});

		const bodies = fetchImpl.mock.calls.map(([, init]) =>
			JSON.parse(String((init as RequestInit | undefined)?.body)),
		);
		expect(bodies.map((body) => body.text).join("")).toBe(text);
		expect(bodies).toHaveLength(2);
		expect(thread.post).not.toHaveBeenCalled();
	});

	it("falls back to raw text when formatted send fails", async () => {
		const { thread, posts } = createThread("telegram:123");
		const logger = createLogger();

		await postTelegramFormattedReply({
			thread,
			text: "Bad **` markdown",
			botToken: "token",
			logger,
			fetchImpl: vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							ok: false,
							description: "Bad Request: can't parse entities",
						}),
						{ status: 400, statusText: "Bad Request" },
					),
			),
		});

		expect(posts).toEqual([{ raw: "Bad **` markdown" }]);
		expect(logger.core.log).toHaveBeenCalledWith(
			"Telegram formatted reply failed; falling back",
			expect.objectContaining({
				severity: "warn",
				transport: "telegram",
				threadId: "telegram:123",
			}),
		);
	});

	it("chunks raw fallback text when formatted send fails", async () => {
		const { thread, posts } = createThread("telegram:123");
		const longText = `${"x".repeat(4096)}tail`;

		await postTelegramFormattedReply({
			thread,
			text: longText,
			botToken: "token",
			logger: createLogger(),
			fetchImpl: vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							ok: false,
							description: "Bad Request: can't parse entities",
						}),
						{ status: 400, statusText: "Bad Request" },
					),
			),
		});

		expect(posts).toEqual([{ raw: "x".repeat(4096) }, { raw: "tail" }]);
	});
});
