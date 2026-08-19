/**
 * Slack bot connector adapter (Gateway RFC, Phase 6 V0).
 *
 * Receives events over Slack Socket Mode (an app-level token opens a
 * WebSocket via `apps.connections.open`; envelopes are acknowledged by
 * `envelope_id`). Slack redelivers events on missed acks and retries, so
 * the crash-safe dedupe cursor is a bounded, ordered set of processed
 * `event_id`s serialized into the cursor — committed atomically with the
 * admission each event caused. Replies go through `chat.postMessage`
 * with the bot token, which stays inside the reply port.
 *
 * Conversation identity — DECISION: Slack channels and threads are
 * SEPARATE conversations, hence separate dedicated Gateway sessions. A
 * top-level channel message normalizes to `externalConversationId =
 * <channel>`; a message inside a thread normalizes to
 * `<channel>#<thread_ts>`. Replies honor the same encoding: a thread
 * conversation replies into its thread (`thread_ts`), a channel
 * conversation posts to the channel top level. This keeps a busy
 * channel's threads contextually isolated from each other and from the
 * channel itself.
 *
 * The credential file holds JSON: `{"appToken": "xapp-...", "botToken":
 * "xoxb-..."}`.
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

/** Slack `chat.postMessage` hard limit for `text` (characters). */
export const SLACK_MAX_MESSAGE_LENGTH = 40_000;

/** Slack API error codes that a retry can never heal. */
const PERMANENT_SLACK_ERRORS = new Set([
	"invalid_auth",
	"account_inactive",
	"token_revoked",
	"token_expired",
	"not_authed",
	"no_permission",
	"missing_scope",
	"ekm_access_denied",
	"channel_not_found",
	"not_in_channel",
	"is_archived",
	"restricted_action",
	"msg_too_long",
]);

/**
 * Encode/decode the channel-vs-thread conversation identity (see the
 * module doc): `<channel>` or `<channel>#<thread_ts>`.
 */
export function slackConversationId(
	channel: string,
	threadTs?: string,
): string {
	return threadTs ? `${channel}#${threadTs}` : channel;
}

export function parseSlackConversationId(conversationId: string): {
	channel: string;
	threadTs?: string;
} {
	const separator = conversationId.indexOf("#");
	if (separator === -1) {
		return { channel: conversationId };
	}
	return {
		channel: conversationId.slice(0, separator),
		threadTs: conversationId.slice(separator + 1),
	};
}

/** Scrub Slack tokens from any operator-visible text. */
export function redactSlackTokens(text: string, credential: string): string {
	try {
		const parsed = parseSlackCredential(credential);
		return text
			.split(parsed.appToken)
			.join("[REDACTED]")
			.split(parsed.botToken)
			.join("[REDACTED]");
	} catch {
		return credential ? text.split(credential).join("[REDACTED]") : text;
	}
}

/** Narrow socket abstraction so tests can script envelopes. */
export interface SlackSocket {
	send(frame: unknown): void;
	onMessage(listener: (frame: unknown) => void): () => void;
	onClose(listener: () => void): () => void;
	close(): void;
}

export type SlackSocketFactory = (
	appToken: string,
	signal: AbortSignal,
) => Promise<SlackSocket>;

export interface SlackAdapterOptions {
	fetchImpl?: typeof fetch;
	apiBase?: string;
	socketFactory?: SlackSocketFactory;
	/** How many processed event ids the dedupe cursor retains. */
	dedupeWindow?: number;
	errorBackoffMs?: number;
}

interface SlackCredential {
	appToken: string;
	botToken: string;
}

export function parseSlackCredential(raw: string): SlackCredential {
	const parsed = JSON.parse(raw) as {
		appToken?: unknown;
		botToken?: unknown;
	};
	if (
		typeof parsed.appToken !== "string" ||
		typeof parsed.botToken !== "string"
	) {
		throw new Error(
			'Slack credential must be JSON {"appToken": "...", "botToken": "..."}',
		);
	}
	return { appToken: parsed.appToken, botToken: parsed.botToken };
}

interface SlackEnvelope {
	type?: string;
	envelope_id?: string;
	payload?: {
		event_id?: string;
		team_id?: string;
		event?: {
			type?: string;
			subtype?: string;
			text?: string;
			user?: string;
			bot_id?: string;
			channel?: string;
			ts?: string;
			thread_ts?: string;
			channel_type?: string;
		};
	};
}

function decodeCursor(cursor: string | undefined): string[] {
	if (!cursor) {
		return [];
	}
	try {
		const parsed = JSON.parse(cursor) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((value): value is string => typeof value === "string")
			: [];
	} catch {
		return [];
	}
}

export class SlackConnectorAdapter implements ConnectorAdapter {
	readonly kind = "slack";
	readonly maxMessageLength = SLACK_MAX_MESSAGE_LENGTH;
	private readonly fetchImpl: typeof fetch;
	private readonly apiBase: string;
	private readonly socketFactory: SlackSocketFactory;
	private readonly dedupeWindow: number;
	private readonly errorBackoffMs: number;

	constructor(options: SlackAdapterOptions = {}) {
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.apiBase = options.apiBase ?? "https://slack.com/api";
		this.socketFactory =
			options.socketFactory ?? this.defaultSocketFactory.bind(this);
		this.dedupeWindow = options.dedupeWindow ?? 256;
		this.errorBackoffMs = options.errorBackoffMs ?? 1_000;
	}

	async run(context: ConnectorAdapterContext): Promise<void> {
		if (!context.credential) {
			throw new Error(
				`Slack connector ${context.descriptor.connectorId} has no credential`,
			);
		}
		const credential = parseSlackCredential(context.credential);
		while (!context.signal.aborted) {
			let socket: SlackSocket;
			try {
				socket = await this.socketFactory(credential.appToken, context.signal);
			} catch (error) {
				if (context.signal.aborted) {
					return;
				}
				context.log({ kind: "slack.connectError", error: String(error) });
				await sleep(this.errorBackoffMs, context.signal);
				continue;
			}
			const closed = new Promise<void>((resolve) => {
				socket.onClose(() => resolve());
			});
			const unsubscribe = socket.onMessage((frame) => {
				this.handleEnvelope(context, socket, frame as SlackEnvelope);
			});
			const onAbort = () => socket.close();
			context.signal.addEventListener("abort", onAbort);
			await closed;
			context.signal.removeEventListener("abort", onAbort);
			unsubscribe();
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
					throw new ConnectorDeliveryError(
						"Slack reply port has no credential",
						{ retryable: false },
					);
				}
				let botToken: string;
				try {
					botToken = parseSlackCredential(credential).botToken;
				} catch (error) {
					// A malformed credential cannot heal by retrying.
					throw new ConnectorDeliveryError(
						`Slack credential is malformed: ${redactSlackTokens(String(error), credential)}`,
						{ retryable: false },
					);
				}
				// A thread conversation replies into its thread; a channel
				// conversation posts top-level (see the module doc).
				const { channel, threadTs } = parseSlackConversationId(
					conversation.externalConversationId,
				);
				let response: Response;
				try {
					response = await fetchImpl(`${apiBase}/chat.postMessage`, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							authorization: `Bearer ${botToken}`,
						},
						body: JSON.stringify({
							channel,
							text,
							...(threadTs ? { thread_ts: threadTs } : {}),
						}),
					});
				} catch (error) {
					throw new ConnectorDeliveryError(
						`Slack chat.postMessage network failure: ${redactSlackTokens(
							String(error),
							credential,
						)}`,
						{ retryable: true },
					);
				}
				const body = (await response.json().catch(() => ({}))) as {
					ok?: boolean;
					error?: string;
					ts?: string;
				};
				if (!response.ok || !body.ok) {
					const code = body.error ?? `http_${response.status}`;
					throw new ConnectorDeliveryError(
						`Slack chat.postMessage failed: ${code}`,
						{
							retryable:
								!PERMANENT_SLACK_ERRORS.has(code) &&
								response.status !== 401 &&
								response.status !== 403,
						},
					);
				}
				return {
					externalMessageIds: body.ts ? [body.ts] : [],
				};
			},
		};
	}

	/** Verify the bot token with `auth.test`; tokens never leave here. */
	async testCredentials(
		_config: Readonly<Record<string, unknown>>,
		credential: string | undefined,
	): Promise<ConnectorCredentialCheck> {
		if (!credential) {
			return { ok: false, detail: "No credential configured" };
		}
		let botToken: string;
		try {
			botToken = parseSlackCredential(credential).botToken;
		} catch (error) {
			return {
				ok: false,
				detail: `Malformed credential: ${redactSlackTokens(String(error), credential)}`,
			};
		}
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.apiBase}/auth.test`, {
				method: "POST",
				headers: { authorization: `Bearer ${botToken}` },
			});
		} catch (error) {
			return {
				ok: false,
				detail: `Network failure: ${redactSlackTokens(String(error), credential)}`,
			};
		}
		const body = (await response.json().catch(() => ({}))) as {
			ok?: boolean;
			error?: string;
			user?: string;
			team?: string;
		};
		if (!response.ok || !body.ok) {
			return { ok: false, detail: body.error ?? `HTTP ${response.status}` };
		}
		return {
			ok: true,
			detail: [body.user, body.team].filter(Boolean).join(" @ ") || undefined,
		};
	}

	private handleEnvelope(
		context: ConnectorAdapterContext,
		socket: SlackSocket,
		envelope: SlackEnvelope,
	): void {
		// Every envelope with an id is acknowledged, exactly once, after
		// its work committed (or was recognized as a duplicate/no-op).
		const ack = () => {
			if (envelope.envelope_id) {
				socket.send({ envelope_id: envelope.envelope_id });
			}
		};
		if (envelope.type !== "events_api") {
			ack();
			return;
		}
		const eventId = envelope.payload?.event_id;
		const event = envelope.payload?.event;
		if (
			!eventId ||
			!event ||
			event.type !== "message" ||
			event.subtype !== undefined ||
			event.bot_id ||
			!event.user ||
			!event.text ||
			!event.channel
		) {
			ack();
			return;
		}
		const seen = decodeCursor(context.cursor());
		if (seen.includes(eventId)) {
			// Redelivery of an already-committed event: acknowledge only.
			ack();
			return;
		}
		const nextSeen = [...seen, eventId].slice(-this.dedupeWindow);
		// Channels and threads are separate conversations => separate
		// dedicated sessions (module doc). A message carrying `thread_ts`
		// is a thread reply and normalizes to `<channel>#<thread_ts>`.
		const conversationId = slackConversationId(event.channel, event.thread_ts);
		const message: NormalizedConnectorMessage = {
			connectorId: context.descriptor.connectorId,
			externalAccountId: event.user,
			externalConversationId: conversationId,
			externalMessageId: eventId,
			text: event.text,
			...(event.ts
				? { sentAt: Math.round(Number.parseFloat(event.ts) * 1000) }
				: {}),
			metadata: {
				platform: "slack",
				channel: event.channel,
				...(event.thread_ts ? { threadTs: event.thread_ts } : {}),
				...(envelope.payload?.team_id
					? { teamId: envelope.payload.team_id }
					: {}),
				...(event.channel_type ? { channelType: event.channel_type } : {}),
				...(event.ts ? { eventTs: event.ts } : {}),
			},
		};
		try {
			context.deliver(message, JSON.stringify(nextSeen));
			ack();
		} catch (error) {
			// Admission failed: do not ack, do not advance the cursor.
			// Slack will redeliver and the retry is explicit.
			context.log({
				kind: "slack.deliverError",
				eventId,
				error: String(error),
			});
		}
	}

	private async defaultSocketFactory(
		appToken: string,
		signal: AbortSignal,
	): Promise<SlackSocket> {
		const response = await this.fetchImpl(
			`${this.apiBase}/apps.connections.open`,
			{
				method: "POST",
				headers: { authorization: `Bearer ${appToken}` },
				signal,
			},
		);
		const body = (await response.json()) as {
			ok?: boolean;
			url?: string;
			error?: string;
		};
		if (!response.ok || !body.ok || !body.url) {
			throw new Error(
				`Slack apps.connections.open failed: ${body.error ?? response.status}`,
			);
		}
		const socket = new WebSocket(body.url);
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => resolve(), { once: true });
			socket.addEventListener(
				"error",
				() => reject(new Error("Slack socket failed to open")),
				{ once: true },
			);
		});
		return {
			send: (frame) => socket.send(JSON.stringify(frame)),
			onMessage: (listener) => {
				const handler = (event: MessageEvent) => {
					try {
						listener(JSON.parse(String(event.data)));
					} catch {
						// Non-JSON frames are ignored.
					}
				};
				socket.addEventListener("message", handler);
				return () => socket.removeEventListener("message", handler);
			},
			onClose: (listener) => {
				socket.addEventListener("close", () => listener(), { once: true });
				return () => {};
			},
			close: () => socket.close(),
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
