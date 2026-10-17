/**
 * Posting a card's messages as real Telegram replies, which the chat library cannot do.
 *
 * The adapter in use implements no `reply`: `reply_to_message_id` appears nowhere in its send
 * path, and asking the thread for a reply throws. Tying the messages with a line of text
 * instead was readable but not what a reply is -- there is no link to follow back to the card,
 * which was the point.
 *
 * So these two messages, and only these two, go straight to the Bot API. The rest of the
 * connector keeps using the library.
 *
 * What makes this safe is that a tap is routed from the update itself: the adapter reads the
 * chat, the message and the callback data off the incoming `callback_query` and never looks
 * the message up. A message posted here is therefore as answerable as one the library posted,
 * provided the two agree on how ids and callback data are written -- which is why both
 * encodings live here, named, instead of being spelled out at the call site.
 */

import { TelegramFormatConverter } from "@chat-adapter/telegram";

import type { CardButton } from "./card-question-message";

const markdown = new TelegramFormatConverter();

/**
 * A card's text as Telegram shows it. The agent's conclusion is markdown; sent as plain text its
 * **bold** and `code` arrived as literal asterisks and backticks. `plain` is the fallback for
 * markup Telegram cannot parse, such as a conclusion clipped in the middle of `**`.
 */
function renderText(
	text: string,
	plain: boolean,
): { text: string; parse_mode?: "MarkdownV2" } {
	return plain
		? { text }
		: { text: markdown.fromMarkdown(text), parse_mode: "MarkdownV2" };
}

interface TelegramResponse {
	ok?: boolean;
	description?: string;
	result?: { message_id?: number };
}

/**
 * Calls the Bot API with the text rendered as markdown, and once more as plain text when Telegram
 * refuses the markup -- losing the notice over a stray asterisk would be worse than showing it.
 */
async function callWithMarkdownFallback(input: {
	botToken: string;
	method: "sendMessage" | "editMessageText";
	buildBody: (plain: boolean) => Record<string, unknown>;
	fetchImpl?: typeof fetch;
}): Promise<TelegramResponse> {
	const call = input.fetchImpl ?? fetch;
	const send = async (plain: boolean): Promise<TelegramResponse> => {
		const response = await call(
			`https://api.telegram.org/bot${input.botToken}/${input.method}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(input.buildBody(plain)),
			},
		);
		return (await response.json()) as TelegramResponse;
	};
	const rendered = await send(false);
	if (
		!rendered.ok &&
		/can't parse entities/i.test(rendered.description ?? "")
	) {
		return await send(true);
	}
	return rendered;
}

export interface TelegramMessageRef {
	chatId: string;
	messageId: string;
}

/**
 * Splits the composite id the adapter hands out (`-1001234:567`) back into its parts.
 *
 * A chat id is negative for a group, so the split is on the last separator rather than the
 * first: `-1004378402573:358` is chat `-1004378402573`, message `358`.
 */
export function splitTelegramMessageId(
	compositeId: string,
): TelegramMessageRef | undefined {
	const separator = compositeId.lastIndexOf(":");
	if (separator <= 0) {
		return undefined;
	}
	const chatId = compositeId.slice(0, separator);
	const messageId = compositeId.slice(separator + 1);
	if (!chatId || !/^\d+$/.test(messageId)) {
		return undefined;
	}
	return { chatId, messageId };
}

/** Joins them back the way the adapter does, so a remembered id matches an incoming tap. */
export function joinTelegramMessageId(
	chatId: string,
	messageId: number | string,
): string {
	return `${chatId}:${messageId}`;
}

export interface CardReplyRequest {
	/** Where to post: the group, and the forum topic inside it when there is one. */
	chatId: string;
	messageThreadId?: string;
	/** The card's anchor, which this message replies to. */
	replyToMessageId: string;
	text: string;
	/** The buttons, in order, each carrying its own callback data. Empty means no keyboard. */
	buttons: readonly CardButton[];
}

function buildInlineKeyboard(
	buttons: readonly CardButton[],
): Array<Array<{ text: string; callback_data: string }>> {
	return buttons.map((button) => [
		{ text: button.label, callback_data: button.actionId },
	]);
}

/**
 * The `sendMessage` body.
 *
 * `allow_sending_without_reply` matters: an anchor deleted by hand would otherwise make
 * Telegram refuse the whole message, and losing a question because the message it pointed at
 * is gone would leave the card waiting forever on an answer nobody was asked for.
 */
export function buildCardReplyBody(
	request: CardReplyRequest,
	options: { plain?: boolean } = {},
): Record<string, unknown> {
	const keyboard = buildInlineKeyboard(request.buttons);
	return {
		chat_id: request.chatId,
		...(request.messageThreadId
			? { message_thread_id: Number(request.messageThreadId) }
			: {}),
		...renderText(request.text, options.plain === true),
		reply_parameters: {
			message_id: Number(request.replyToMessageId),
			allow_sending_without_reply: true,
		},
		...(keyboard.length > 0
			? { reply_markup: { inline_keyboard: keyboard } }
			: {}),
	};
}

export interface PostCardReplyResult {
	/** The new message, in the composite form the rest of the connector remembers ids in. */
	messageId: string;
}

/**
 * Sends it. Returns nothing when Telegram refuses, so the caller can fall back to posting
 * through the library rather than dropping the message.
 */
export async function postTelegramCardReply(input: {
	botToken: string;
	request: CardReplyRequest;
	fetchImpl?: typeof fetch;
}): Promise<PostCardReplyResult | undefined> {
	try {
		const payload = await callWithMarkdownFallback({
			botToken: input.botToken,
			method: "sendMessage",
			buildBody: (plain) => buildCardReplyBody(input.request, { plain }),
			fetchImpl: input.fetchImpl,
		});
		if (!payload.ok || typeof payload.result?.message_id !== "number") {
			return undefined;
		}
		return {
			messageId: joinTelegramMessageId(
				input.request.chatId,
				payload.result.message_id,
			),
		};
	} catch {
		return undefined;
	}
}

/**
 * The forum topic a thread lives in, read off the binding key the connector already uses.
 *
 * A key is `telegram:<chat>:<topic>` in a group with topics, and `telegram:<chat>` in a direct
 * message, where there is no topic to name.
 */
export function resolveTelegramTopicId(threadKey: string): string | undefined {
	const parts = threadKey.split(":");
	const topic = parts.length >= 3 ? parts[parts.length - 1] : undefined;
	return topic && /^\d+$/.test(topic) ? topic : undefined;
}

/**
 * Rewrites a message posted here, which is what removes its keyboard.
 *
 * `editMessageText` with no `reply_markup` clears the buttons, so an answered question stops
 * being answerable in the same call that marks what was chosen. Given `buttons`, the message is
 * rewritten with those instead -- a Concluir that would discard work asks on the same message.
 */
export async function editTelegramCardMessage(input: {
	botToken: string;
	messageRef: string;
	text: string;
	/** A new keyboard to show instead; without it the edit clears the buttons. */
	buttons?: readonly CardButton[];
	fetchImpl?: typeof fetch;
}): Promise<boolean> {
	const ref = splitTelegramMessageId(input.messageRef);
	if (!ref) {
		return false;
	}
	try {
		const payload = await callWithMarkdownFallback({
			botToken: input.botToken,
			method: "editMessageText",
			buildBody: (plain) => ({
				chat_id: ref.chatId,
				message_id: Number(ref.messageId),
				...renderText(input.text, plain),
				...(input.buttons && input.buttons.length > 0
					? {
							reply_markup: {
								inline_keyboard: buildInlineKeyboard(input.buttons),
							},
						}
					: {}),
			}),
			fetchImpl: input.fetchImpl,
		});
		return payload.ok === true;
	} catch {
		return false;
	}
}
