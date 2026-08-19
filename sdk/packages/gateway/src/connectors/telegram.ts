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
import type { ConnectorAdapter, ConnectorAdapterContext } from "./adapter";

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
					throw new Error("Telegram reply port has no credential");
				}
				const response = await fetchImpl(
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
				if (!response.ok) {
					throw new Error(
						`Telegram sendMessage failed: HTTP ${response.status}`,
					);
				}
			},
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
