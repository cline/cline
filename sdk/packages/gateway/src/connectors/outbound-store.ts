/**
 * Outbound connector message store (Gateway RFC, Phase 6).
 *
 * Every outbound message — run replies, proactive agent sends, schedule
 * and event notifications, operator test messages — is persisted here
 * BEFORE any delivery attempt, then delivered by the supervision worker
 * independently from model execution. Durability rules:
 *
 * - Idempotency keys are unique: re-enqueueing the same logical message
 *   (retry, crash replay, tool retry) returns the existing record
 *   instead of creating a duplicate.
 * - Claims are conditional writes with an expiry, so two workers can
 *   never deliver the same message and a claim held by a dead process
 *   recovers.
 * - Transient failures reschedule with exponential backoff
 *   (`next_attempt_at`); permanent failures (auth/permission) settle as
 *   `failed` immediately and are never retried indefinitely.
 * - The message content never contains credentials, and `last_error` is
 *   stored redacted by the delivery worker.
 */

import type {
	BotId,
	ConnectorId,
	OutboundMessageId,
	RunId,
	ScheduleId,
} from "@cline/shared/gateway";
import { createOutboundMessageId } from "@cline/shared/gateway";
import type { GatewayDatabase } from "../db";

export type OutboundMessageState =
	| "pending"
	| "sending"
	| "delivered"
	| "failed";

export type OutboundMessageOrigin =
	| "run-reply"
	| "proactive"
	| "schedule"
	| "event"
	| "test";

export interface OutboundMessageRecord {
	readonly outboundId: OutboundMessageId;
	readonly botId: BotId;
	readonly connectorId: ConnectorId;
	readonly externalAccountId: string;
	readonly externalConversationId: string;
	readonly origin: OutboundMessageOrigin;
	readonly originRunId?: RunId;
	readonly originScheduleId?: ScheduleId;
	readonly idempotencyKey: string;
	readonly content: string;
	readonly state: OutboundMessageState;
	readonly attempts: number;
	readonly nextAttemptAt: number;
	readonly claimedBy?: string;
	readonly claimExpiresAt?: number;
	readonly lastError?: string;
	/** Platform message id(s); several when the content was split. */
	readonly externalMessageIds?: readonly string[];
	readonly createdAt: number;
	readonly lastAttemptAt?: number;
	readonly deliveredAt?: number;
}

function rowToRecord(row: Record<string, unknown>): OutboundMessageRecord {
	return {
		outboundId: String(row.outbound_id) as OutboundMessageId,
		botId: String(row.bot_id) as BotId,
		connectorId: String(row.connector_id) as ConnectorId,
		externalAccountId: String(row.external_account_id),
		externalConversationId: String(row.external_conversation_id),
		origin: String(row.origin) as OutboundMessageOrigin,
		originRunId:
			row.origin_run_id === null
				? undefined
				: (String(row.origin_run_id) as RunId),
		originScheduleId:
			row.origin_schedule_id === null
				? undefined
				: (String(row.origin_schedule_id) as ScheduleId),
		idempotencyKey: String(row.idempotency_key),
		content: String(row.content),
		state: String(row.state) as OutboundMessageState,
		attempts: Number(row.attempts),
		nextAttemptAt: Number(row.next_attempt_at),
		claimedBy: row.claimed_by === null ? undefined : String(row.claimed_by),
		claimExpiresAt:
			row.claim_expires_at === null ? undefined : Number(row.claim_expires_at),
		lastError: row.last_error === null ? undefined : String(row.last_error),
		externalMessageIds:
			row.external_message_ids_json === null
				? undefined
				: (JSON.parse(String(row.external_message_ids_json)) as string[]),
		createdAt: Number(row.created_at),
		lastAttemptAt:
			row.last_attempt_at === null ? undefined : Number(row.last_attempt_at),
		deliveredAt:
			row.delivered_at === null ? undefined : Number(row.delivered_at),
	};
}

export interface EnqueueOutboundParams {
	readonly botId: BotId;
	readonly connectorId: ConnectorId;
	readonly externalAccountId: string;
	readonly externalConversationId: string;
	readonly origin: OutboundMessageOrigin;
	readonly originRunId?: RunId;
	readonly originScheduleId?: ScheduleId;
	readonly idempotencyKey: string;
	readonly content: string;
}

export class ConnectorOutboundStore {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	/**
	 * Persist an outbound message before any delivery attempt. Duplicate
	 * idempotency keys return the existing record (`created: false`) —
	 * never a second message.
	 */
	enqueue(
		params: EnqueueOutboundParams,
		now: number,
	): { record: OutboundMessageRecord; created: boolean } {
		const existing = this.getByIdempotencyKey(params.idempotencyKey);
		if (existing) {
			return { record: existing, created: false };
		}
		const outboundId = createOutboundMessageId();
		this.database.db
			.prepare(
				`INSERT INTO connector_outbound (
					outbound_id, bot_id, connector_id, external_account_id,
					external_conversation_id, origin, origin_run_id,
					origin_schedule_id, idempotency_key, content, state,
					next_attempt_at, created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)
				ON CONFLICT(idempotency_key) DO NOTHING;`,
			)
			.run(
				outboundId,
				params.botId,
				params.connectorId,
				params.externalAccountId,
				params.externalConversationId,
				params.origin,
				params.originRunId ?? null,
				params.originScheduleId ?? null,
				params.idempotencyKey,
				params.content,
				now,
			);
		const record = this.getByIdempotencyKey(params.idempotencyKey);
		if (!record) {
			throw new Error("connector_outbound insert lost its row");
		}
		return { record, created: record.outboundId === outboundId };
	}

	get(outboundId: OutboundMessageId): OutboundMessageRecord | undefined {
		const row = this.database.db
			.prepare("SELECT * FROM connector_outbound WHERE outbound_id = ?;")
			.get(outboundId);
		return row ? rowToRecord(row) : undefined;
	}

	getByIdempotencyKey(key: string): OutboundMessageRecord | undefined {
		const row = this.database.db
			.prepare("SELECT * FROM connector_outbound WHERE idempotency_key = ?;")
			.get(key);
		return row ? rowToRecord(row) : undefined;
	}

	/** Deliverable now: pending and due, or sending with an expired claim. */
	listDeliverable(
		now: number,
		limit: number,
	): readonly OutboundMessageRecord[] {
		return this.database.db
			.prepare(
				`SELECT * FROM connector_outbound
				WHERE (state = 'pending' AND next_attempt_at <= ?)
					OR (state = 'sending' AND claim_expires_at < ?)
				ORDER BY created_at, outbound_id LIMIT ?;`,
			)
			.all(now, now, limit)
			.map(rowToRecord);
	}

	/**
	 * Claim one message for delivery. Conditional: only a due pending
	 * message or an expired claim can be taken, so concurrent workers can
	 * never deliver the same message.
	 */
	claim(
		outboundId: OutboundMessageId,
		claimedBy: string,
		now: number,
		claimTtlMs: number,
	): boolean {
		const result = this.database.db
			.prepare(
				`UPDATE connector_outbound
				SET state = 'sending', claimed_by = ?, claim_expires_at = ?,
					attempts = attempts + 1, last_attempt_at = ?
				WHERE outbound_id = ?
					AND ((state = 'pending' AND next_attempt_at <= ?)
						OR (state = 'sending' AND claim_expires_at < ?));`,
			)
			.run(claimedBy, now + claimTtlMs, now, outboundId, now, now);
		return Boolean(result.changes);
	}

	markDelivered(
		outboundId: OutboundMessageId,
		externalMessageIds: readonly string[],
		now: number,
	): void {
		this.database.db
			.prepare(
				`UPDATE connector_outbound
				SET state = 'delivered', delivered_at = ?, last_error = NULL,
					claimed_by = NULL, claim_expires_at = NULL,
					external_message_ids_json = ?
				WHERE outbound_id = ?;`,
			)
			.run(now, JSON.stringify(externalMessageIds), outboundId);
	}

	/** Transient failure: back to pending with a scheduled retry. */
	markRetry(
		outboundId: OutboundMessageId,
		error: string,
		nextAttemptAt: number,
	): void {
		this.database.db
			.prepare(
				`UPDATE connector_outbound
				SET state = 'pending', next_attempt_at = ?, last_error = ?,
					claimed_by = NULL, claim_expires_at = NULL
				WHERE outbound_id = ?;`,
			)
			.run(nextAttemptAt, error, outboundId);
	}

	/** Permanent failure (auth/permission/exhausted retries): settle. */
	markFailed(outboundId: OutboundMessageId, error: string): void {
		this.database.db
			.prepare(
				`UPDATE connector_outbound
				SET state = 'failed', last_error = ?,
					claimed_by = NULL, claim_expires_at = NULL
				WHERE outbound_id = ?;`,
			)
			.run(error, outboundId);
	}

	list(filter: {
		connectorId?: ConnectorId;
		botId?: BotId;
		state?: OutboundMessageState;
		limit?: number;
	}): readonly OutboundMessageRecord[] {
		const clauses: string[] = [];
		const params: unknown[] = [];
		if (filter.connectorId) {
			clauses.push("connector_id = ?");
			params.push(filter.connectorId);
		}
		if (filter.botId) {
			clauses.push("bot_id = ?");
			params.push(filter.botId);
		}
		if (filter.state) {
			clauses.push("state = ?");
			params.push(filter.state);
		}
		params.push(filter.limit ?? 100);
		const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
		return this.database.db
			.prepare(
				`SELECT * FROM connector_outbound ${where}
				ORDER BY created_at DESC, outbound_id DESC LIMIT ?;`,
			)
			.all(...params)
			.map(rowToRecord);
	}

	/** Recent messages for one conversation (rate limiting input). */
	countRecent(
		connectorId: ConnectorId,
		externalConversationId: string,
		origin: OutboundMessageOrigin,
		since: number,
	): number {
		const row = this.database.db
			.prepare(
				`SELECT COUNT(*) AS n FROM connector_outbound
				WHERE connector_id = ? AND external_conversation_id = ?
					AND origin = ? AND created_at >= ?;`,
			)
			.get(connectorId, externalConversationId, origin, since);
		return Number(row?.n ?? 0);
	}
}
