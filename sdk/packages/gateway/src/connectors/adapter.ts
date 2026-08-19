/**
 * Connector adapter contract (Gateway RFC, Phase 6).
 *
 * An adapter turns one external messaging platform into normalized
 * connector messages and an authorized reply capability. Adapters run
 * under the ConnectorManager's supervision, receive exactly their own
 * connector's config/credential (never another bot's), and report
 * progress through a crash-safe dedupe cursor: `deliver` commits the
 * cursor in the same transaction as the run the message admitted, so a
 * crash between the two can never happen and a restart resumes from the
 * cursor without duplicates.
 */

import type {
	ConnectorDescriptor,
	ConnectorReplyPort,
	NormalizedConnectorMessage,
} from "@cline/bot";

/**
 * A delivery failure classified at the adapter boundary. `retryable`
 * separates transient platform failures (rate limits, 5xx, network) —
 * retried with backoff — from permanent ones (revoked/invalid
 * credentials, missing permissions, unknown conversation), which settle
 * as `failed` immediately and are never retried indefinitely. Messages
 * MUST already be redacted: no tokens, no sensitive headers.
 */
export class ConnectorDeliveryError extends Error {
	readonly retryable: boolean;

	constructor(message: string, options: { retryable: boolean }) {
		super(message);
		this.name = "ConnectorDeliveryError";
		this.retryable = options.retryable;
	}
}

export interface ConnectorCredentialCheck {
	readonly ok: boolean;
	/** Redacted human-readable detail (bot identity, error class). */
	readonly detail?: string;
}

export interface ConnectorAdapterContext {
	readonly descriptor: ConnectorDescriptor;
	readonly config: Readonly<Record<string, unknown>>;
	/** Credential resolved from the owner-only secret file, in memory. */
	readonly credential?: string;
	/** Aborted when the manager stops or restarts the worker. */
	readonly signal: AbortSignal;
	/** Current dedupe cursor (undefined on first start). */
	cursor(): string | undefined;
	/**
	 * Deliver one normalized message. Admission and the cursor advance
	 * commit atomically; on failure the cursor does not move.
	 */
	deliver(message: NormalizedConnectorMessage, nextCursor: string): void;
	/** Advance the cursor past updates that admit no work. */
	commitCursor(nextCursor: string): void;
	log(entry: Record<string, unknown>): void;
}

export interface ConnectorAdapter {
	readonly kind: string;
	/**
	 * Hard platform limit for one outbound message; longer content is
	 * split by the delivery worker before it reaches the reply port.
	 */
	readonly maxMessageLength: number;
	/** Long-running receive loop; resolves only when the signal aborts. */
	run(context: ConnectorAdapterContext): Promise<void>;
	/**
	 * Build the authorized reply capability for a connector. The bot
	 * side receives this narrow port; the credential stays inside it.
	 * Failures are thrown as `ConnectorDeliveryError` (classified and
	 * redacted).
	 */
	createReplyPort(
		config: Readonly<Record<string, unknown>>,
		credential: string | undefined,
	): ConnectorReplyPort;
	/**
	 * Verify a credential against the platform (e.g. Telegram `getMe`,
	 * Slack `auth.test`) without sending a message. Never throws with
	 * credential material in the error.
	 */
	testCredentials(
		config: Readonly<Record<string, unknown>>,
		credential: string | undefined,
	): Promise<ConnectorCredentialCheck>;
}
