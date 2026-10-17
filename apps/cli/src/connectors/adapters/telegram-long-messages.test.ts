import type { AdapterPostableMessage } from "chat";
import { describe, expect, it, vi } from "vitest";
import {
	asTelegramDocumentPostable,
	buildTelegramShortPreview,
	readOverflowingTelegramText,
	sendLongMessagesAsDocuments,
	splitLongCardNotice,
} from "./telegram-long-messages";

const NOW = new Date(2026, 9, 13, 8, 0);
const LONG = `# Relatório do card\n\n${"palavra ".repeat(700)}`;

function fakeAdapter() {
	const posted: AdapterPostableMessage[] = [];
	const adapter = {
		postMessage: vi.fn(
			async (_threadId: string, message: AdapterPostableMessage) => {
				posted.push(message);
				return { id: "1", threadId: "telegram:1", raw: {} };
			},
		),
	};
	return { adapter, posted };
}

describe("readOverflowingTelegramText", () => {
	it("finds the text of a raw, markdown or plain string message past the limit", () => {
		expect(readOverflowingTelegramText({ raw: LONG })).toBe(LONG);
		expect(readOverflowingTelegramText({ markdown: LONG })).toBe(LONG);
		expect(readOverflowingTelegramText(LONG)).toBe(LONG);
	});

	it("leaves a message that fits alone", () => {
		expect(readOverflowingTelegramText({ raw: "curto" })).toBeUndefined();
	});

	it("measures markdown as Telegram shows it, not by its markup", () => {
		// 4000 visible characters wrapped in bold: over 4096 written, under it shown.
		const text = `**${"a".repeat(2000)}** **${"b".repeat(2000)}**`;
		expect(readOverflowingTelegramText({ markdown: text })).toBeUndefined();
	});

	it("leaves a message that already carries files or a card", () => {
		expect(
			readOverflowingTelegramText({
				raw: LONG,
				files: [{ data: Buffer.from("x"), filename: "x.txt" }],
			}),
		).toBeUndefined();
		expect(
			readOverflowingTelegramText({
				card: { type: "card", children: [] },
				fallbackText: LONG,
			} as unknown as AdapterPostableMessage),
		).toBeUndefined();
	});
});

describe("asTelegramDocumentPostable", () => {
	it("carries the whole text as a named .md file under a short caption", async () => {
		const postable = asTelegramDocumentPostable(LONG, NOW);
		expect(postable.raw.length).toBeLessThanOrEqual(1024);
		expect(postable.raw.startsWith("Relatório do card")).toBe(true);
		const [file] = postable.files;
		expect(file?.filename).toBe("relatorio-do-card.md");
		expect(file?.mimeType).toBe("text/markdown");
		expect(Buffer.from(file?.data as Buffer).toString("utf8")).toBe(LONG);
	});
});

describe("buildTelegramShortPreview", () => {
	it("keeps the start of the text and points at the file above", () => {
		const preview = buildTelegramShortPreview(LONG);
		expect(preview.length).toBeLessThanOrEqual(1024);
		expect(preview.startsWith("Relatório do card")).toBe(true);
		expect(preview.endsWith("… (texto completo no arquivo acima)")).toBe(true);
	});
});

describe("sendLongMessagesAsDocuments", () => {
	it("turns an overflowing message into a .md document", async () => {
		const { adapter, posted } = fakeAdapter();
		sendLongMessagesAsDocuments(adapter, () => NOW);

		await adapter.postMessage("telegram:1:7", { raw: LONG });

		const [message] = posted as Array<{ raw: string; files: unknown[] }>;
		expect(message?.files).toHaveLength(1);
		expect(message?.raw.length).toBeLessThanOrEqual(1024);
	});

	it("passes a message that fits through untouched", async () => {
		const { adapter, posted } = fakeAdapter();
		sendLongMessagesAsDocuments(adapter, () => NOW);

		await adapter.postMessage("telegram:1", { markdown: "**ok**" });

		expect(posted).toEqual([{ markdown: "**ok**" }]);
	});

	it("still delivers the message, cut, when Telegram refuses the file", async () => {
		const posted: AdapterPostableMessage[] = [];
		const adapter = {
			postMessage: vi.fn(
				async (_threadId: string, message: AdapterPostableMessage) => {
					if (typeof message === "object" && "files" in message) {
						throw new Error("Bad Request: file");
					}
					posted.push(message);
					return { id: "2", threadId: "telegram:1", raw: {} };
				},
			),
		};
		sendLongMessagesAsDocuments(adapter, () => NOW);

		const sent = await adapter.postMessage("telegram:1", { raw: LONG });

		expect(posted).toEqual([{ raw: LONG }]);
		expect(sent.id).toBe("2");
	});
});

describe("splitLongCardNotice", () => {
	it("sends a long card notice's full text as a file and keeps a short message for its buttons", () => {
		const notice = splitLongCardNotice(LONG, NOW);
		expect(notice.document?.files[0]?.filename).toBe("relatorio-do-card.md");
		expect(notice.text.length).toBeLessThanOrEqual(1024);
		expect(notice.text.endsWith("(texto completo no arquivo acima)")).toBe(
			true,
		);
	});

	it("leaves a notice that fits as it is", () => {
		expect(splitLongCardNotice("Pronto para revisão", NOW)).toEqual({
			text: "Pronto para revisão",
		});
	});
});
