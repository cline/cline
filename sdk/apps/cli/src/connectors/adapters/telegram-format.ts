import { markdownToFormattable } from "@gramio/format/markdown";
import type { Thread } from "chat";
import type { CliLoggerAdapter } from "../../logging/adapter";
import type { ConnectorThreadState } from "../thread-bindings";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_MESSAGE_LIMIT = 4096;

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
): string {
	const detail = parsed?.description || body.trim().slice(0, 240);
	return detail
		? `Telegram sendMessage failed (${response.status} ${response.statusText}): ${detail}`
		: `Telegram sendMessage failed (${response.status} ${response.statusText})`;
}

async function readTelegramApiResponse(
	response: Response,
): Promise<TelegramApiResponse | undefined> {
	const text = await response.text();
	try {
		const parsed = JSON.parse(text) as TelegramApiResponse;
		if (!response.ok || parsed.ok !== true) {
			throw new Error(describeTelegramApiFailure(response, text, parsed));
		}
		return parsed;
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(describeTelegramApiFailure(response, text, undefined));
		}
		throw error;
	}
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
}): Promise<void> {
	const fetchImpl = input.fetchImpl ?? fetch;
	let payloads: TelegramSendMessagePayload[] = [];
	let sentPayloadCount = 0;
	try {
		payloads = buildTelegramFormattedPayloads(input.thread.id, input.text);
		const apiBaseUrl = trimTrailingSlashes(
			input.apiBaseUrl?.trim() || TELEGRAM_API_BASE,
		);
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
