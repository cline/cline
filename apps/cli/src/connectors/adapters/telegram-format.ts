import { markdownToFormattable } from "@gramio/format/markdown";
import type { Thread } from "chat";
import type { CliLoggerAdapter } from "../../logging/adapter";
import type { ConnectorThreadState } from "../thread-bindings";

const TELEGRAM_API_BASE = "https://api.telegram.org";
export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const TELEGRAM_CAPTION_LIMIT = 1024;
const TELEGRAM_DOCUMENT_NOTE = "… (resposta completa no arquivo)";
const TELEGRAM_DOCUMENT_SLUG_LIMIT = 60;

type TelegramMessageEntity = {
	type: string;
	offset: number;
	length: number;
	url?: string;
	language?: string;
	custom_emoji_id?: string;
};

type TelegramThreadId = {
	chatId: string;
	messageThreadId?: number;
};

type TelegramSendMessagePayload = {
	chat_id: string;
	message_thread_id?: number;
	text: string;
	entities?: TelegramMessageEntity[];
	link_preview_options: {
		is_disabled: true;
	};
};

type TelegramApiResponse = {
	ok?: boolean;
	description?: string;
	result?: unknown;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function trimTrailingSlashes(value: string): string {
	let end = value.length;
	while (end > 0 && value[end - 1] === "/") {
		end -= 1;
	}
	return value.slice(0, end);
}

function normalizeTelegramText(text: string): string {
	return text.trim() ? text : " ";
}

export function parseTelegramThreadId(threadId: string): TelegramThreadId {
	if (!threadId.startsWith("telegram:")) {
		return { chatId: threadId };
	}
	const parts = threadId.split(":");
	if (parts.length < 2 || parts.length > 3 || !parts[1]) {
		throw new Error(`Invalid Telegram thread ID: ${threadId}`);
	}
	const messageThreadPart = parts[2];
	if (!messageThreadPart) {
		return { chatId: parts[1] };
	}
	const messageThreadId = Number.parseInt(messageThreadPart, 10);
	if (!Number.isFinite(messageThreadId)) {
		throw new Error(`Invalid Telegram thread topic ID: ${threadId}`);
	}
	return { chatId: parts[1], messageThreadId };
}

function validEntityForText(
	entity: TelegramMessageEntity,
	maxTextLength: number,
): boolean {
	return (
		typeof entity.type === "string" &&
		Number.isFinite(entity.offset) &&
		Number.isFinite(entity.length) &&
		entity.offset >= 0 &&
		entity.length > 0 &&
		entity.offset + entity.length <= maxTextLength
	);
}

function chunkFormattedMessage(
	text: string,
	entities: TelegramMessageEntity[],
): Array<{ text: string; entities: TelegramMessageEntity[] }> {
	if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
		return [
			{
				text,
				entities: entities.filter((entity) =>
					validEntityForText(entity, text.length),
				),
			},
		];
	}
	const chunks: Array<{ text: string; entities: TelegramMessageEntity[] }> = [];
	for (
		let startOffset = 0;
		startOffset < text.length;
		startOffset += TELEGRAM_MESSAGE_LIMIT
	) {
		const endOffset = Math.min(
			startOffset + TELEGRAM_MESSAGE_LIMIT,
			text.length,
		);
		const chunkText = text.slice(startOffset, endOffset);
		const chunkEntities = entities
			.map((entity) => {
				const entityStart = entity.offset;
				const entityEnd = entity.offset + entity.length;
				const overlapStart = Math.max(entityStart, startOffset);
				const overlapEnd = Math.min(entityEnd, endOffset);
				if (overlapStart >= overlapEnd) {
					return undefined;
				}
				return {
					...entity,
					offset: overlapStart - startOffset,
					length: overlapEnd - overlapStart,
				};
			})
			.filter((entity): entity is TelegramMessageEntity =>
				Boolean(entity && validEntityForText(entity, chunkText.length)),
			);
		chunks.push({ text: chunkText, entities: chunkEntities });
	}
	return chunks;
}

function buildTelegramSendPayload(
	threadId: string,
	text: string,
	entities: TelegramMessageEntity[],
): TelegramSendMessagePayload {
	const parsedThread = parseTelegramThreadId(threadId);
	const body = normalizeTelegramText(text);
	return {
		chat_id: parsedThread.chatId,
		...(parsedThread.messageThreadId !== undefined
			? { message_thread_id: parsedThread.messageThreadId }
			: {}),
		text: body,
		...(entities.length > 0 ? { entities } : {}),
		link_preview_options: { is_disabled: true },
	};
}

export function buildTelegramFormattedPayloads(
	threadId: string,
	text: string,
): TelegramSendMessagePayload[] {
	const formatted = markdownToFormattable(normalizeTelegramText(text));
	const chunks = chunkFormattedMessage(
		formatted.text,
		formatted.entities as TelegramMessageEntity[],
	);
	return chunks.map((chunk) =>
		buildTelegramSendPayload(threadId, chunk.text, chunk.entities),
	);
}

export function buildTelegramFormattedPayload(
	threadId: string,
	text: string,
): TelegramSendMessagePayload {
	return (
		buildTelegramFormattedPayloads(threadId, text)[0] ?? {
			chat_id: parseTelegramThreadId(threadId).chatId,
			text: " ",
			link_preview_options: { is_disabled: true },
		}
	);
}

function describeTelegramApiFailure(
	response: Response,
	body: string,
	parsed: TelegramApiResponse | undefined,
	method: string,
): string {
	const detail = parsed?.description || body.trim().slice(0, 240);
	return detail
		? `Telegram ${method} failed (${response.status} ${response.statusText}): ${detail}`
		: `Telegram ${method} failed (${response.status} ${response.statusText})`;
}

async function readTelegramApiResponse(
	response: Response,
	method = "sendMessage",
): Promise<TelegramApiResponse | undefined> {
	const text = await response.text();
	try {
		const parsed = JSON.parse(text) as TelegramApiResponse;
		if (!response.ok || parsed.ok !== true) {
			throw new Error(
				describeTelegramApiFailure(response, text, parsed, method),
			);
		}
		return parsed;
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(
				describeTelegramApiFailure(response, text, undefined, method),
			);
		}
		throw error;
	}
}

/**
 * The file a long reply arrives as is named after what it is about: its first heading.
 * A `# comment` in a shell block is not a heading, so fenced code is skipped first.
 */
export function buildTelegramDocumentName(text: string, now: Date): string {
	const withoutCode = text.replace(/^```[\s\S]*?^```/gm, "");
	const heading = withoutCode.match(/^#{1,6}[ \t]+(.+?)[ \t#]*$/m)?.[1] ?? "";
	const slug = heading
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, TELEGRAM_DOCUMENT_SLUG_LIMIT)
		.replace(/-+$/, "");
	if (slug) {
		return `${slug}.md`;
	}
	const pad = (value: number) => String(value).padStart(2, "0");
	return `resposta-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;
}

/**
 * The opening of a long text as plain text, cut at a word and closed with `note`, so the
 * conversation still reads without opening the file that carries the rest.
 */
export function buildTelegramPreview(
	text: string,
	limit: number,
	note: string,
): string {
	const plain = markdownToFormattable(normalizeTelegramText(text))
		.text.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	const room = limit - note.length;
	let cut = plain.slice(0, room);
	const lastBreak = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
	if (plain.length > room && lastBreak > room / 2) {
		cut = cut.slice(0, lastBreak);
	}
	return `${cut.trimEnd()}${note}`;
}

/** What shows under the file in the chat: the reply's opening. */
export function buildTelegramDocumentCaption(text: string): string {
	return buildTelegramPreview(
		text,
		TELEGRAM_CAPTION_LIMIT,
		TELEGRAM_DOCUMENT_NOTE,
	);
}

async function sendTelegramDocument(input: {
	apiBaseUrl: string;
	botToken: string;
	threadId: string;
	text: string;
	now: Date;
	fetchImpl: FetchLike;
}): Promise<void> {
	const parsedThread = parseTelegramThreadId(input.threadId);
	const form = new FormData();
	form.append("chat_id", parsedThread.chatId);
	if (parsedThread.messageThreadId !== undefined) {
		form.append("message_thread_id", String(parsedThread.messageThreadId));
	}
	form.append("caption", buildTelegramDocumentCaption(input.text));
	form.append(
		"document",
		new Blob([input.text], { type: "text/markdown;charset=utf-8" }),
		buildTelegramDocumentName(input.text, input.now),
	);
	const response = await input.fetchImpl(
		`${input.apiBaseUrl}/bot${input.botToken}/sendDocument`,
		{ method: "POST", body: form },
	);
	await readTelegramApiResponse(response, "sendDocument");
}

export async function postTelegramFormattedReply<
	TState extends ConnectorThreadState,
>(input: {
	thread: Thread<TState>;
	text: string;
	botToken: string;
	logger: CliLoggerAdapter;
	apiBaseUrl?: string;
	fetchImpl?: FetchLike;
	now?: () => Date;
}): Promise<void> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const apiBaseUrl = trimTrailingSlashes(
		input.apiBaseUrl?.trim() || TELEGRAM_API_BASE,
	);
	let payloads: TelegramSendMessagePayload[] = [];
	let sentPayloadCount = 0;
	try {
		payloads = buildTelegramFormattedPayloads(input.thread.id, input.text);
		// More than one message means Telegram would get the reply in slices cut every 4096
		// characters, mid-word or mid-code-block. One file reads better; the slices stay as
		// the way out when Telegram refuses the file.
		if (payloads.length > 1) {
			try {
				await sendTelegramDocument({
					apiBaseUrl,
					botToken: input.botToken,
					threadId: input.thread.id,
					text: input.text,
					now: input.now?.() ?? new Date(),
					fetchImpl,
				});
				return;
			} catch (error) {
				input.logger.core.log(
					"Telegram document reply failed; sending as messages",
					{
						severity: "warn",
						transport: "telegram",
						threadId: input.thread.id,
						error: error instanceof Error ? error.message : String(error),
					},
				);
			}
		}
		for (const payload of payloads) {
			const response = await fetchImpl(
				`${apiBaseUrl}/bot${input.botToken}/sendMessage`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
				},
			);
			await readTelegramApiResponse(response);
			sentPayloadCount += 1;
		}
	} catch (error) {
		input.logger.core.log("Telegram formatted reply failed; falling back", {
			severity: "warn",
			transport: "telegram",
			threadId: input.thread.id,
			error: error instanceof Error ? error.message : String(error),
		});
		const remainingText =
			sentPayloadCount > 0
				? payloads
						.slice(sentPayloadCount)
						.map((payload) => payload.text)
						.join("")
				: input.text;
		for (const chunk of chunkTelegramRawText(remainingText)) {
			await input.thread.post({ raw: chunk });
		}
	}
}

function chunkTelegramRawText(text: string): string[] {
	const body = normalizeTelegramText(text);
	const chunks: string[] = [];
	for (let index = 0; index < body.length; index += TELEGRAM_MESSAGE_LIMIT) {
		chunks.push(body.slice(index, index + TELEGRAM_MESSAGE_LIMIT));
	}
	return chunks.length > 0 ? chunks : [" "];
}
