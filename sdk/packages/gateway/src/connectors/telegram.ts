/**
 * Telegram Bot API connector adapter (Gateway RFC, Phase 6 V0).
 *
 * Receives updates through `getUpdates` long polling. The Telegram
 * `update_id` is the natural crash-safe dedupe cursor: the adapter polls
 * with `offset = cursor + 1`, so an update whose admission committed is
 * never fetched again, and an update that failed before commit is
 * re-fetched after restart. Replies go through `sendMessage` using the
 * bot token, which stays inside the reply port — bots and routes never
 * see it.
 */

import type {
	ConnectorReplyPort,
	NormalizedConnectorMessage,
} from "@cline/bot";
import type {
	ConnectorAdapter,
	ConnectorAdapterContext,
	ConnectorCredentialCheck,
} from "./adapter";
import { ConnectorDeliveryError } from "./adapter";

/** Telegram sendMessage hard limit (characters). */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/** HTTP statuses that indicate a revoked/insufficient credential. */
const PERMANENT_HTTP_STATUSES = new Set([400, 401, 403, 404]);

export interface TelegramAdapterOptions {
	fetchImpl?: typeof fetch;
	apiBase?: string;
	/** Long-poll timeout in seconds. */
	pollTimeoutSeconds?: number;
	/** Delay between polls after an error. */
	errorBackoffMs?: number;
}

interface TelegramUpdate {
	update_id: number;
	message?: {
		message_id: number;
		text?: string;
		date?: number;
		from?: {
			id: number;
			username?: string;
			first_name?: string;
			is_bot?: boolean;
		};
		chat: { id: number; type?: string; title?: string };
	};
}

export class TelegramConnectorAdapter implements ConnectorAdapter {
	readonly kind = "telegram";
	readonly maxMessageLength = TELEGRAM_MAX_MESSAGE_LENGTH;
	private readonly fetchImpl: typeof fetch;
	private readonly apiBase: string;
	private readonly pollTimeoutSeconds: number;
	private readonly errorBackoffMs: number;

	constructor(options: TelegramAdapterOptions = {}) {
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.apiBase = options.apiBase ?? "https://api.telegram.org";
		this.pollTimeoutSeconds = options.pollTimeoutSeconds ?? 25;
		this.errorBackoffMs = options.errorBackoffMs ?? 1_000;
	}

	async run(context: ConnectorAdapterContext): Promise<void> {
		const token = context.credential;
		if (!token) {
			throw new Error(
				`Telegram connector ${context.descriptor.connectorId} has no bot token credential`,
			);
		}
		while (!context.signal.aborted) {
			const cursor = context.cursor();
			const offset =
				cursor !== undefined ? Number.parseInt(cursor, 10) + 1 : undefined;
			let updates: TelegramUpdate[];
			try {
				updates = await this.getUpdates(token, offset, context.signal);
			} catch (error) {
				if (context.signal.aborted) {
					return;
				}
				context.log({ kind: "telegram.pollError", error: String(error) });
				await sleep(this.errorBackoffMs, context.signal);
				continue;
			}
			for (const update of updates) {
				if (context.signal.aborted) {
					return;
				}
				const nextCursor = String(update.update_id);
				const message = this.normalize(context, update);
				if (message) {
					context.deliver(message, nextCursor);
				} else {
					context.commitCursor(nextCursor);
				}
			}
		}
	}

	createReplyPort(
		_config: Readonly<Record<string, unknown>>,
		credential: string | undefined,
	): ConnectorReplyPort {
		const fetchImpl = this.fetchImpl;
		const apiBase = this.apiBase;
		return {
			reply: async (conversation, text) => {
				if (!credential) {
					// A missing credential cannot heal by retrying.
					throw new ConnectorDeliveryError(
						"Telegram reply port has no credential",
						{ retryable: false },
					);
				}
				let response: Response;
				try {
					response = await fetchImpl(
						`${apiBase}/bot${credential}/sendMessage`,
						{
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({
								chat_id: conversation.externalConversationId,
								text,
							}),
						},
					);
				} catch (error) {
					// Network failures are transient. The raw error may embed
					// the request URL (which carries the token): redact.
					throw new ConnectorDeliveryError(
						`Telegram sendMessage network failure: ${redactTelegramToken(
							String(error),
							credential,
						)}`,
						{ retryable: true },
					);
				}
				if (!response.ok) {
					// 401/403: revoked token; 400/404: bad chat — permanent.
					// 429/5xx: transient platform failures.
					throw new ConnectorDeliveryError(
						`Telegram sendMessage failed: HTTP ${response.status}`,
						{ retryable: !PERMANENT_HTTP_STATUSES.has(response.status) },
					);
				}
				const body = (await response.json().catch(() => undefined)) as
					| { ok?: boolean; result?: { message_id?: number } }
					| undefined;
				return {
					externalMessageIds:
						body?.result?.message_id !== undefined
							? [String(body.result.message_id)]
							: [],
				};
			},
		};
	}

	/** Verify the bot token with `getMe`; the token never leaves here. */
	async testCredentials(
		_config: Readonly<Record<string, unknown>>,
		credential: string | undefined,
	): Promise<ConnectorCredentialCheck> {
		if (!credential) {
			return { ok: false, detail: "No credential configured" };
		}
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.apiBase}/bot${credential}/getMe`);
		} catch (error) {
			return {
				ok: false,
				detail: `Network failure: ${redactTelegramToken(String(error), credential)}`,
			};
		}
		if (!response.ok) {
			return { ok: false, detail: `HTTP ${response.status}` };
		}
		const body = (await response.json().catch(() => undefined)) as
			| { ok?: boolean; result?: { username?: string } }
			| undefined;
		if (!body?.ok) {
			return { ok: false, detail: "Telegram getMe returned a non-ok body" };
		}
		return {
			ok: true,
			...(body.result?.username ? { detail: `@${body.result.username}` } : {}),
		};
	}

	private async getUpdates(
		token: string,
		offset: number | undefined,
		signal: AbortSignal,
	): Promise<TelegramUpdate[]> {
		const params = new URLSearchParams({
			timeout: String(this.pollTimeoutSeconds),
			allowed_updates: JSON.stringify(["message"]),
		});
		if (offset !== undefined) {
			params.set("offset", String(offset));
		}
		const response = await this.fetchImpl(
			`${this.apiBase}/bot${token}/getUpdates?${params.toString()}`,
			{ signal },
		);
		if (!response.ok) {
			throw new Error(`Telegram getUpdates failed: HTTP ${response.status}`);
		}
		const body = (await response.json()) as {
			ok?: boolean;
			result?: TelegramUpdate[];
		};
		if (!body.ok || !Array.isArray(body.result)) {
			throw new Error("Telegram getUpdates returned a non-ok body");
		}
		return [...body.result].sort((a, b) => a.update_id - b.update_id);
	}

	private normalize(
		context: ConnectorAdapterContext,
		update: TelegramUpdate,
	): NormalizedConnectorMessage | undefined {
		const message = update.message;
		if (!message?.text || message.from?.is_bot) {
			return undefined;
		}
		const allowedUserId = context.config.allowedUserId;
		if (
			typeof allowedUserId === "string" &&
			allowedUserId.length > 0 &&
			String(message.from?.id ?? "") !== allowedUserId
		) {
			return undefined;
		}
		return {
			connectorId: context.descriptor.connectorId,
			externalAccountId: String(message.from?.id ?? "unknown"),
			externalConversationId: String(message.chat.id),
			externalMessageId: String(update.update_id),
			text: message.text,
			...(message.from?.username || message.from?.first_name
				? {
						senderDisplay:
							message.from.username ?? message.from.first_name ?? "",
					}
				: {}),
			...(message.date ? { sentAt: message.date * 1000 } : {}),
			metadata: {
				platform: "telegram",
				chatType: message.chat.type,
				...(message.chat.title ? { chatTitle: message.chat.title } : {}),
				telegramMessageId: message.message_id,
			},
		};
	}
}

/** Telegram tokens travel in request paths; scrub them from any text. */
export function redactTelegramToken(text: string, token: string): string {
	return token ? text.split(token).join("[REDACTED]") : text;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(done, ms);
		function done() {
			signal.removeEventListener("abort", done);
			clearTimeout(timer);
			resolve();
		}
		signal.addEventListener("abort", done);
	});
}
