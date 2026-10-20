import { describe, expect, it, vi } from "vitest";

import {
	buildCardReplyBody,
	editTelegramCardMessage,
	joinTelegramMessageId,
	postTelegramCardReply,
	resolveTelegramTopicId,
	splitTelegramMessageId,
} from "./telegram-card-reply";

describe("splitTelegramMessageId", () => {
	it("splits the composite id a group message carries", () => {
		expect(splitTelegramMessageId("-1004378402573:358")).toEqual({
			chatId: "-1004378402573",
			messageId: "358",
		});
	});

	// Today's chat ids carry no separator of their own, so this case is defensive rather than
	// observed -- but the message number is always last, and reading the first separator would
	// one day send an edit to a chat that does not exist.
	it("takes the message number from the last separator, not the first", () => {
		expect(splitTelegramMessageId("-100:7:358")).toEqual({
			chatId: "-100:7",
			messageId: "358",
		});
	});

	it("refuses an id that is not one", () => {
		expect(splitTelegramMessageId("358")).toBeUndefined();
		expect(splitTelegramMessageId("-100:abc")).toBeUndefined();
		expect(splitTelegramMessageId(":358")).toBeUndefined();
	});

	it("round-trips with the way the adapter writes them", () => {
		expect(joinTelegramMessageId("-1004378402573", 358)).toBe(
			"-1004378402573:358",
		);
	});
});

describe("buildCardReplyBody", () => {
	it("replies to the anchor, inside the forum topic", () => {
		const body = buildCardReplyBody({
			chatId: "-1004378402573",
			messageThreadId: "49",
			replyToMessageId: "358",
			text: "Gravar?",
			buttons: [],
		});

		expect(body).toMatchObject({
			chat_id: "-1004378402573",
			message_thread_id: 49,
			text: "Gravar?",
			reply_parameters: { message_id: 358 },
		});
	});

	// An anchor deleted by hand would otherwise make Telegram refuse the whole message, and
	// the question would be lost rather than merely unanchored.
	it("still sends when the anchor is gone", () => {
		const body = buildCardReplyBody({
			chatId: "-100",
			replyToMessageId: "1",
			text: "Gravar?",
			buttons: [],
		});

		expect(body.reply_parameters).toMatchObject({
			allow_sending_without_reply: true,
		});
	});

	// The tap is routed from the callback data alone, so this has to carry the connector's own
	// action id or the answer reaches nothing.
	it("puts each option on a button carrying its action", () => {
		const body = buildCardReplyBody({
			chatId: "-100",
			replyToMessageId: "1",
			text: "Gravar?",
			buttons: [
				{ label: "Gravar", actionId: "kbq:a3ae5:1" },
				{ label: "Descartar", actionId: "kbq:a3ae5:2" },
			],
		});

		expect(body.reply_markup).toEqual({
			inline_keyboard: [
				[{ text: "Gravar", callback_data: "kbq:a3ae5:1" }],
				[{ text: "Descartar", callback_data: "kbq:a3ae5:2" }],
			],
		});
	});

	it("sends no keyboard when there is nothing to choose", () => {
		const body = buildCardReplyBody({
			chatId: "-100",
			replyToMessageId: "1",
			text: "Ready for review",
			buttons: [],
		});

		expect(body).not.toHaveProperty("reply_markup");
	});
});

describe("markdown in a card's messages", () => {
	// The agent's conclusion is markdown. Sent as plain text, its **bold** and `code` arrived
	// as literal asterisks and backticks and its lists as one run-on paragraph.
	it("renders the text as Telegram MarkdownV2", () => {
		const body = buildCardReplyBody({
			chatId: "-100",
			replyToMessageId: "1",
			text: "- **Hash:** `189af67`\n- **Stash:** não usado (ok).",
			buttons: [],
		});

		expect(body.parse_mode).toBe("MarkdownV2");
		expect(body.text).toBe(
			"\\- *Hash:* `189af67`\n\\- *Stash:* não usado \\(ok\\)\\.",
		);
	});

	it("can be built as plain text, for when Telegram refuses the markup", () => {
		const body = buildCardReplyBody(
			{
				chatId: "-100",
				replyToMessageId: "1",
				text: "**Hash:** `189af67`",
				buttons: [],
			},
			{ plain: true },
		);

		expect(body).not.toHaveProperty("parse_mode");
		expect(body.text).toBe("**Hash:** `189af67`");
	});

	// A conclusion clipped in the middle of `**` is markup Telegram cannot parse; losing the
	// whole notice over that would be worse than showing the asterisks.
	it("posts it plain when Telegram cannot parse the markup", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({
				json: async () => ({
					ok: false,
					description: "Bad Request: can't parse entities: unclosed bold",
				}),
			})
			.mockResolvedValueOnce({
				json: async () => ({ ok: true, result: { message_id: 401 } }),
			}) as unknown as typeof fetch;

		const result = await postTelegramCardReply({
			botToken: "token",
			fetchImpl,
			request: {
				chatId: "-100",
				replyToMessageId: "1",
				text: "**corte no meio",
				buttons: [],
			},
		});

		expect(result).toEqual({ messageId: "-100:401" });
		const retried = JSON.parse(
			String((vi.mocked(fetchImpl).mock.calls[1]?.[1] as RequestInit).body),
		);
		expect(retried).not.toHaveProperty("parse_mode");
		expect(retried.text).toBe("**corte no meio");
	});

	it("edits with markdown too, falling back the same way", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce({
				json: async () => ({
					ok: false,
					description: "Bad Request: can't parse entities",
				}),
			})
			.mockResolvedValueOnce({
				json: async () => ({ ok: true }),
			}) as unknown as typeof fetch;

		const edited = await editTelegramCardMessage({
			botToken: "token",
			messageRef: "-100:400",
			text: "**Hash:** `abc`",
			fetchImpl,
		});

		expect(edited).toBe(true);
		const first = JSON.parse(
			String((vi.mocked(fetchImpl).mock.calls[0]?.[1] as RequestInit).body),
		);
		expect(first.parse_mode).toBe("MarkdownV2");
		const second = JSON.parse(
			String((vi.mocked(fetchImpl).mock.calls[1]?.[1] as RequestInit).body),
		);
		expect(second).not.toHaveProperty("parse_mode");
	});
});

describe("postTelegramCardReply", () => {
	it("returns the new message in the form ids are remembered in", async () => {
		const fetchImpl = vi.fn(async () => ({
			json: async () => ({ ok: true, result: { message_id: 400 } }),
		})) as unknown as typeof fetch;

		const result = await postTelegramCardReply({
			botToken: "token",
			fetchImpl,
			request: {
				chatId: "-1004378402573",
				replyToMessageId: "358",
				text: "Gravar?",
				buttons: [],
			},
		});

		expect(result).toEqual({ messageId: "-1004378402573:400" });
	});

	// The caller falls back to the library on nothing, so a refusal must not look like success
	// and must not throw either.
	it("returns nothing when Telegram refuses", async () => {
		const fetchImpl = vi.fn(async () => ({
			json: async () => ({ ok: false, description: "chat not found" }),
		})) as unknown as typeof fetch;

		await expect(
			postTelegramCardReply({
				botToken: "token",
				fetchImpl,
				request: {
					chatId: "-100",
					replyToMessageId: "1",
					text: "Gravar?",
					buttons: [],
				},
			}),
		).resolves.toBeUndefined();
	});

	it("returns nothing when the call itself fails", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("network down");
		}) as unknown as typeof fetch;

		await expect(
			postTelegramCardReply({
				botToken: "token",
				fetchImpl,
				request: {
					chatId: "-100",
					replyToMessageId: "1",
					text: "Gravar?",
					buttons: [],
				},
			}),
		).resolves.toBeUndefined();
	});
});

describe("resolveTelegramTopicId", () => {
	it("reads the forum topic off the binding key", () => {
		expect(resolveTelegramTopicId("telegram:-1004378402573:49")).toBe("49");
	});

	// A direct message has no topic, and guessing one would post into nowhere.
	it("finds none in a direct message", () => {
		expect(resolveTelegramTopicId("telegram:946217355")).toBeUndefined();
	});

	it("ignores a trailing part that is not a topic", () => {
		expect(resolveTelegramTopicId("telegram:-100:general")).toBeUndefined();
	});
});

describe("editTelegramCardMessage", () => {
	// Editing with no reply_markup is what clears the buttons, so an answered question stops
	// being answerable in the same call that marks what was chosen.
	it("rewrites the message without a keyboard", async () => {
		const fetchImpl = vi.fn(async () => ({
			json: async () => ({ ok: true }),
		})) as unknown as typeof fetch;

		const edited = await editTelegramCardMessage({
			botToken: "token",
			messageRef: "-1004378402573:400",
			text: "Gravar?\n\n✅ Descartar",
			fetchImpl,
		});

		expect(edited).toBe(true);
		const body = JSON.parse(
			String((vi.mocked(fetchImpl).mock.calls[0]?.[1] as RequestInit).body),
		);
		expect(body).toMatchObject({
			chat_id: "-1004378402573",
			message_id: 400,
			text: "Gravar?\n\n✅ Descartar",
		});
		expect(body).not.toHaveProperty("reply_markup");
	});

	// Concluir that would discard work asks first, on the same message: the rewrite has to
	// carry the confirmation's buttons instead of clearing them.
	it("rewrites the message with a new keyboard when given buttons", async () => {
		const fetchImpl = vi.fn(async () => ({
			json: async () => ({ ok: true }),
		})) as unknown as typeof fetch;

		await editTelegramCardMessage({
			botToken: "token",
			messageRef: "-1004378402573:400",
			text: "1 commit não integrado será descartado.",
			buttons: [
				{ label: "Concluir mesmo assim", actionId: "kba:52609:done!" },
				{ label: "Cancelar", actionId: "kba:52609:cancel" },
			],
			fetchImpl,
		});

		const body = JSON.parse(
			String((vi.mocked(fetchImpl).mock.calls[0]?.[1] as RequestInit).body),
		);
		expect(body.reply_markup).toEqual({
			inline_keyboard: [
				[{ text: "Concluir mesmo assim", callback_data: "kba:52609:done!" }],
				[{ text: "Cancelar", callback_data: "kba:52609:cancel" }],
			],
		});
	});

	it("reports failure instead of throwing", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("network down");
		}) as unknown as typeof fetch;

		await expect(
			editTelegramCardMessage({
				botToken: "token",
				messageRef: "-100:1",
				text: "x",
				fetchImpl,
			}),
		).resolves.toBe(false);
	});
});
