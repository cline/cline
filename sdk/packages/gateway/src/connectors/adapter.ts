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
	/** Long-running receive loop; resolves only when the signal aborts. */
	run(context: ConnectorAdapterContext): Promise<void>;
	/**
	 * Build the authorized reply capability for a connector. The bot
	 * side receives this narrow port; the credential stays inside it.
	 */
	createReplyPort(
		config: Readonly<Record<string, unknown>>,
		credential: string | undefined,
	): ConnectorReplyPort;
}
