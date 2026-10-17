import type { SentMessage, Thread } from "chat";
import { describe, expect, it, vi } from "vitest";
import type { CliLoggerAdapter } from "../../logging/adapter";
import type { ConnectorThreadState } from "../thread-bindings";
import {
	buildTelegramDocumentCaption,
	buildTelegramDocumentName,
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

	it("sends a reply too long for one message as a single .md document", async () => {
		const { thread } = createThread("telegram:-100123:7");
		const text = `# Pesquisa de filas\n\n${"palavra ".repeat(700)}`;
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

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] ?? [];
		expect(url).toBe("https://api.telegram.org/bottoken/sendDocument");
		const form = (init as RequestInit).body as FormData;
		expect(form.get("chat_id")).toBe("-100123");
		expect(form.get("message_thread_id")).toBe("7");
		const document = form.get("document") as File;
		expect(document.name).toBe("pesquisa-de-filas.md");
		expect(await document.text()).toBe(text);
		const caption = String(form.get("caption"));
		expect(caption.length).toBeLessThanOrEqual(1024);
		expect(caption.startsWith("Pesquisa de filas")).toBe(true);
		expect(caption).toMatch(/palavra… \(resposta completa no arquivo\)$/);
		expect(form.get("parse_mode")).toBeNull();
		expect(thread.post).not.toHaveBeenCalled();
	});

	it("still sends the whole reply as messages when the document is refused", async () => {
		const { thread } = createThread("telegram:123");
		const text = `${"a".repeat(4096)}tail`;
		const logger = createLogger();
		const fetchImpl = vi.fn(async (url: string | URL, _init?: RequestInit) => {
			if (String(url).endsWith("/sendDocument")) {
				return new Response(
					JSON.stringify({ ok: false, description: "Bad Request: file" }),
					{ status: 400, statusText: "Bad Request" },
				);
			}
			return new Response(JSON.stringify({ ok: true, result: {} }), {
				status: 200,
			});
		});

		await postTelegramFormattedReply({
			thread,
			text,
			botToken: "token",
			logger,
			fetchImpl,
		});

		const bodies = fetchImpl.mock.calls
			.filter(([url]) => String(url).endsWith("/sendMessage"))
			.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
		expect(bodies.map((body) => body.text).join("")).toBe(text);
		expect(bodies).toHaveLength(2);
		expect(logger.core.log).toHaveBeenCalledWith(
			"Telegram document reply failed; sending as messages",
			expect.objectContaining({ severity: "warn", transport: "telegram" }),
		);
		expect(thread.post).not.toHaveBeenCalled();
	});

	it("names the document after the first heading, without accents", () => {
		expect(
			buildTelegramDocumentName(
				"Intro\n\n## Análise de Ações & Riscos\n\ncorpo",
				new Date(2026, 9, 12, 9, 30),
			),
		).toBe("analise-de-acoes-riscos.md");
	});

	it("ignores a # line inside a code block when naming the document", () => {
		expect(
			buildTelegramDocumentName(
				"```bash\n# instala tudo\nbun install\n```\n\n# Guia real\n",
				new Date(2026, 9, 12, 9, 30),
			),
		).toBe("guia-real.md");
	});

	it("names the document by date when the reply has no heading", () => {
		expect(
			buildTelegramDocumentName("só texto", new Date(2026, 9, 12, 9, 5)),
		).toBe("resposta-2026-10-12-0905.md");
	});

	it("keeps a long heading to 60 characters without a trailing dash", () => {
		const name = buildTelegramDocumentName(
			`# ${"palavra ".repeat(20)}`,
			new Date(2026, 9, 12, 9, 30),
		);
		const slug = name.replace(/\.md$/, "");
		expect(slug.length).toBeLessThanOrEqual(60);
		expect(slug.endsWith("-")).toBe(false);
	});

	it("captions the document with its start as plain text", () => {
		const caption = buildTelegramDocumentCaption(
			`**Resumo** com \`código\`\n\n${"palavra ".repeat(300)}`,
		);
		expect(caption.startsWith("Resumo com código")).toBe(true);
		expect(caption.length).toBeLessThanOrEqual(1024);
		expect(caption.endsWith("… (resposta completa no arquivo)")).toBe(true);
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
