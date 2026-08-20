/**
 * Outbound delivery supervision (Gateway RFC, Phase 6).
 *
 * Delivers persisted outbound connector messages independently from
 * model execution: a run reply retries here, at the transport layer,
 * WITHOUT ever rerunning the model. Behavior:
 *
 * - Only claimed messages are delivered; claims are conditional writes
 *   with an expiry, so concurrent workers can never send the same
 *   message and pending deliveries resume after a Gateway restart.
 * - Transient platform failures (rate limits, 5xx, network) reschedule
 *   with exponential backoff up to a bounded attempt count; permanent
 *   failures (revoked/malformed credentials, missing permissions) settle
 *   as `failed` immediately — never retried indefinitely.
 * - Content is split into platform-limit-sized chunks before the reply
 *   port sees it.
 * - Every settlement is recorded as a durable event and an audit entry;
 *   stored errors are redacted (adapters classify AND scrub).
 */

import type { OutboundMessageId } from "@cline/shared/gateway";
import type { GatewayDatabase } from "../db";
import type { GatewayStores } from "../stores";
import type { ConnectorAdapter } from "./adapter";
import { ConnectorDeliveryError } from "./adapter";
import type { OutboundMessageRecord } from "./outbound-store";

/**
 * Split a message into platform-sized chunks, preferring newline (then
 * space) boundaries so text stays readable.
 */
export function splitMessageForPlatform(
	content: string,
	maxLength: number,
): string[] {
	if (maxLength <= 0) {
		throw new Error(`Invalid platform message limit: ${maxLength}`);
	}
	const chunks: string[] = [];
	let remaining = content;
	while (remaining.length > maxLength) {
		const window = remaining.slice(0, maxLength);
		let cut = window.lastIndexOf("\n");
		if (cut < maxLength * 0.5) {
			cut = window.lastIndexOf(" ");
		}
		if (cut < maxLength * 0.5) {
			cut = maxLength;
		}
		chunks.push(remaining.slice(0, cut).trimEnd());
		remaining = remaining.slice(cut).trimStart();
	}
	if (remaining.length > 0 || chunks.length === 0) {
		chunks.push(remaining);
	}
	return chunks;
}

export interface OutboundDeliveryWorkerOptions {
	database: GatewayDatabase;
	stores: GatewayStores;
	adapters: Record<string, ConnectorAdapter>;
	readCredential?: (credentialRef: string) => string | undefined;
	instanceId: string;
	clock?: () => number;
	claimTtlMs?: number;
	/** Total delivery attempts for transient failures (>=1). */
	maxAttempts?: number;
	backoff?: { baseMs?: number; maxMs?: number };
	/** Timer cadence; 0 disables the timer (tests call tick()). */
	tickIntervalMs?: number;
	batchSize?: number;
	telemetry?: (event: Record<string, unknown>) => void;
}

export interface DeliveryTickReport {
	readonly claimed: number;
	readonly delivered: number;
	readonly retried: number;
	readonly failed: number;
}

export class OutboundDeliveryWorker {
	private readonly options: OutboundDeliveryWorkerOptions;
	private readonly clock: () => number;
	private readonly telemetry: (event: Record<string, unknown>) => void;
	private timer: ReturnType<typeof setInterval> | undefined;
	private ticking: Promise<DeliveryTickReport> | undefined;

	constructor(options: OutboundDeliveryWorkerOptions) {
		this.options = options;
		this.clock = options.clock ?? (() => Date.now());
		this.telemetry = options.telemetry ?? (() => {});
	}

	start(): void {
		const interval = this.options.tickIntervalMs ?? 500;
		if (interval > 0 && !this.timer) {
			this.timer = setInterval(() => {
				void this.tick().catch((error) => {
					this.telemetry({
						kind: "connector.deliveryTickFailed",
						error: error instanceof Error ? error.message : String(error),
					});
				});
			}, interval);
			this.timer.unref?.();
		}
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	/** One delivery pass (serialized; concurrent calls share a pass). */
	tick(now: number = this.clock()): Promise<DeliveryTickReport> {
		if (this.ticking) {
			return this.ticking;
		}
		this.ticking = this.tickOnce(now).finally(() => {
			this.ticking = undefined;
		});
		return this.ticking;
	}

	/**
	 * Attempt one specific message right now (used by the proactive tool
	 * to report a live delivery status). Returns the fresh record.
	 */
	async deliverNow(
		outboundId: OutboundMessageId,
	): Promise<OutboundMessageRecord | undefined> {
		const now = this.clock();
		const record = this.options.stores.connectorOutbound.get(outboundId);
		if (!record || record.state === "delivered" || record.state === "failed") {
			return record;
		}
		const claimed = this.options.stores.connectorOutbound.claim(
			outboundId,
			this.options.instanceId,
			now,
			this.options.claimTtlMs ?? 60_000,
		);
		if (claimed) {
			await this.deliver(outboundId, now, {
				delivered: 0,
				retried: 0,
				failed: 0,
			});
		}
		return this.options.stores.connectorOutbound.get(outboundId);
	}

	// ---------------------------------------------------------------------
	// Internals
	// ---------------------------------------------------------------------

	private async tickOnce(now: number): Promise<DeliveryTickReport> {
		const report = { claimed: 0, delivered: 0, retried: 0, failed: 0 };
		const deliverable = this.options.stores.connectorOutbound.listDeliverable(
			now,
			this.options.batchSize ?? 16,
		);
		for (const record of deliverable) {
			const claimed = this.options.stores.connectorOutbound.claim(
				record.outboundId,
				this.options.instanceId,
				now,
				this.options.claimTtlMs ?? 60_000,
			);
			if (!claimed) {
				continue;
			}
			report.claimed += 1;
			await this.deliver(record.outboundId, now, report);
		}
		return report;
	}

	private async deliver(
		outboundId: OutboundMessageId,
		now: number,
		report: { delivered: number; retried: number; failed: number },
	): Promise<void> {
		const stores = this.options.stores;
		const record = stores.connectorOutbound.get(outboundId);
		if (!record) {
			return;
		}
		const connector = stores.connectors.get(record.connectorId);
		if (!connector) {
			this.settleFailed(record, "Connector no longer exists", report);
			return;
		}
		const adapter = this.options.adapters[connector.kind];
		if (!adapter) {
			this.settleFailed(
				record,
				`No adapter for connector kind "${connector.kind}"`,
				report,
			);
			return;
		}
		if (connector.status !== "enabled") {
			// A disabled connector is transient from the message's point of
			// view: re-enabling resumes delivery (bounded by maxAttempts).
			this.scheduleRetry(record, "Connector is disabled", now, report);
			return;
		}
		let credential: string | undefined;
		if (connector.credentialRef) {
			try {
				credential = this.options.readCredential?.(connector.credentialRef);
			} catch (error) {
				// A loose-mode/unreadable secret file is an operator problem;
				// retrying cannot heal it.
				this.settleFailed(
					record,
					`Credential unavailable: ${error instanceof Error ? error.message : String(error)}`,
					report,
				);
				return;
			}
		}
		const replyPort = adapter.createReplyPort(connector.config, credential);
		const chunks = splitMessageForPlatform(
			record.content,
			adapter.maxMessageLength,
		);
		const externalMessageIds: string[] = [];
		try {
			for (const chunk of chunks) {
				const result = await replyPort.reply(
					{
						externalAccountId: record.externalAccountId,
						externalConversationId: record.externalConversationId,
					},
					chunk,
				);
				if (result?.externalMessageIds) {
					externalMessageIds.push(...result.externalMessageIds);
				}
			}
		} catch (error) {
			const redacted = this.redact(error, credential);
			const retryable =
				error instanceof ConnectorDeliveryError ? error.retryable : true;
			if (retryable) {
				this.scheduleRetry(record, redacted, now, report);
			} else {
				this.settleFailed(record, redacted, report);
			}
			return;
		}
		stores.connectorOutbound.markDelivered(
			record.outboundId,
			externalMessageIds,
			this.clock(),
		);
		report.delivered += 1;
		this.options.database.transaction(() => {
			stores.events.append(
				"connector.outboundDelivered",
				{
					botId: record.botId,
					...(record.originRunId ? { runId: record.originRunId } : {}),
				},
				{
					outboundId: record.outboundId,
					connectorId: record.connectorId,
					externalConversationId: record.externalConversationId,
					origin: record.origin,
					chunks: chunks.length,
				},
				this.clock(),
			);
			stores.audit.record(
				"gateway",
				"connector.outboundDelivered",
				record.outboundId,
				{ connectorId: record.connectorId, origin: record.origin },
				this.clock(),
			);
		});
		this.telemetry({
			kind: "connector.outboundDelivered",
			outboundId: record.outboundId,
		});
	}

	private scheduleRetry(
		record: OutboundMessageRecord,
		error: string,
		now: number,
		report: { retried: number; failed: number },
	): void {
		const maxAttempts = Math.max(1, this.options.maxAttempts ?? 8);
		// `attempts` was incremented by the claim that led here.
		if (record.attempts + 1 > maxAttempts) {
			this.settleFailed(
				record,
				`Retries exhausted after ${record.attempts} attempts: ${error}`,
				report,
			);
			return;
		}
		const baseMs = this.options.backoff?.baseMs ?? 1_000;
		const maxMs = this.options.backoff?.maxMs ?? 300_000;
		// First retry waits baseMs; each further attempt doubles it.
		const delay = Math.min(
			maxMs,
			baseMs * 2 ** Math.max(0, record.attempts - 1),
		);
		this.options.stores.connectorOutbound.markRetry(
			record.outboundId,
			error,
			now + delay,
		);
		report.retried += 1;
		this.telemetry({
			kind: "connector.outboundRetryScheduled",
			outboundId: record.outboundId,
			attempts: record.attempts + 1,
			delayMs: delay,
		});
	}

	private settleFailed(
		record: OutboundMessageRecord,
		error: string,
		report: { failed: number },
	): void {
		const stores = this.options.stores;
		stores.connectorOutbound.markFailed(record.outboundId, error);
		report.failed += 1;
		this.options.database.transaction(() => {
			stores.events.append(
				"connector.outboundDeliveryFailed",
				{
					botId: record.botId,
					...(record.originRunId ? { runId: record.originRunId } : {}),
				},
				{
					outboundId: record.outboundId,
					connectorId: record.connectorId,
					origin: record.origin,
					error,
				},
				this.clock(),
			);
			stores.audit.record(
				"gateway",
				"connector.outboundDeliveryFailed",
				record.outboundId,
				{ connectorId: record.connectorId, error },
				this.clock(),
			);
		});
		this.telemetry({
			kind: "connector.outboundDeliveryFailed",
			outboundId: record.outboundId,
			error,
		});
	}

	/** Belt-and-braces: adapters redact, and we scrub again before storing. */
	private redact(error: unknown, credential: string | undefined): string {
		let text = error instanceof Error ? error.message : String(error);
		if (credential) {
			text = text.split(credential).join("[REDACTED]");
		}
		return text;
	}
}
