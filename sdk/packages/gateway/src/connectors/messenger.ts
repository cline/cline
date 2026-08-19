/**
 * Connector messenger (Gateway RFC, Phase 6).
 *
 * The single policy gate through which outbound connector messages are
 * created:
 *
 * - Run replies: when a connector-originated run completes, its final
 *   assistant response is enqueued for the originating conversation —
 *   resolved through provenance and the durable route. Failed, aborted,
 *   and interrupted runs never produce a successful reply. The enqueue
 *   happens in the same transaction as the run settlement, keyed by the
 *   run id, so crash recovery cannot duplicate it and retries happen at
 *   the delivery layer without rerunning the model.
 * - Proactive sends (`send_connector_message` tool): constrained. The
 *   destination defaults to the originating conversation; any explicit
 *   destination must belong to the current bot; destinations other than
 *   the originating conversation require either a known route or an
 *   operator approval through the server-request broker; per-conversation
 *   rate limits apply; the message is persisted before delivery with an
 *   idempotency key; the returned status never carries credentials.
 * - Notifications: schedules and Gateway events target a connector route
 *   (bot-ownership enforced) and become ordinary outbound messages.
 */

import type { RunRecord } from "@cline/bot";
import type {
	BotId,
	ConnectorId,
	RunId,
	ScheduleId,
} from "@cline/shared/gateway";
import type { GatewayDatabase } from "../db";
import type { ApprovalBroker } from "../runtime";
import type { GatewayStores } from "../stores";
import type {
	EnqueueOutboundParams,
	OutboundMessageOrigin,
	OutboundMessageRecord,
} from "./outbound-store";
import { ConnectorScopeViolationError } from "./store";

export class ProactiveSendRejectedError extends Error {
	readonly retryable: boolean;

	constructor(message: string, options: { retryable?: boolean } = {}) {
		super(message);
		this.name = "ProactiveSendRejectedError";
		this.retryable = options.retryable ?? false;
	}
}

export interface ConnectorDestination {
	readonly connectorId: ConnectorId;
	readonly externalConversationId: string;
	readonly externalAccountId?: string;
}

export interface ProactiveSendParams {
	readonly botId: BotId;
	/** The run asking to send (provenance source + audit subject). */
	readonly originRunId?: RunId;
	readonly text: string;
	/** Omitted: the originating connector conversation of the run. */
	readonly destination?: ConnectorDestination;
	readonly idempotencyKey: string;
	/** Actor recorded in the audit trail (e.g. `run:<id>`). */
	readonly requestedBy: string;
}

export interface ConnectorMessengerOptions {
	database: GatewayDatabase;
	stores: GatewayStores;
	/**
	 * Approval broker for destinations other than the originating
	 * conversation. Without one, unrelated destinations are rejected.
	 */
	approvals?: ApprovalBroker | (() => ApprovalBroker | undefined);
	clock?: () => number;
	/** Proactive per-conversation rate limit (sliding window). */
	proactiveRateLimit?: { max: number; windowMs: number };
	/** Called after an enqueue so the delivery worker can react quickly. */
	onEnqueued?: () => void;
	telemetry?: (event: Record<string, unknown>) => void;
}

export class ConnectorMessenger {
	private readonly options: ConnectorMessengerOptions;
	private readonly clock: () => number;
	private readonly telemetry: (event: Record<string, unknown>) => void;

	constructor(options: ConnectorMessengerOptions) {
		this.options = options;
		this.clock = options.clock ?? (() => Date.now());
		this.telemetry = options.telemetry ?? (() => {});
	}

	/**
	 * Run-settlement hook (called in the same transaction as the terminal
	 * run write): connector-originated runs that COMPLETED reply to their
	 * originating conversation. Every other terminal state stays silent —
	 * failed/aborted/interrupted output is never sent as a reply.
	 */
	handleRunTerminal(record: RunRecord): void {
		const provenance = this.options.stores.provenance.get(record.runId);
		if (provenance?.mode !== "connector" || !provenance.connectorId) {
			return;
		}
		if (record.state !== "completed") {
			this.telemetry({
				kind: "connector.replySuppressed",
				runId: record.runId,
				state: record.state,
			});
			return;
		}
		const text = record.outputText?.trim();
		if (!text) {
			return;
		}
		if (!provenance.externalAccountId || !provenance.externalConversationId) {
			return;
		}
		// Resolve the durable route; a conversation whose route was removed
		// gets no reply (the mapping is the authorization).
		const route = this.options.stores.connectorRoutes.get(
			provenance.connectorId,
			provenance.externalAccountId,
			provenance.externalConversationId,
		);
		if (!route || route.botId !== record.botId) {
			this.telemetry({
				kind: "connector.replyRouteMissing",
				runId: record.runId,
				connectorId: provenance.connectorId,
			});
			return;
		}
		this.enqueue(
			{
				botId: record.botId,
				connectorId: provenance.connectorId,
				externalAccountId: route.externalAccountId,
				externalConversationId: route.externalConversationId,
				origin: "run-reply",
				originRunId: record.runId,
				// One reply per run, ever — crash replays and re-settlements
				// collapse onto this key.
				idempotencyKey: `run-reply:${record.runId}`,
				content: text,
			},
			"gateway",
		);
	}

	/**
	 * Notification path for schedules and Gateway events: target one
	 * connector conversation on behalf of a bot. Ownership is enforced;
	 * the caller supplies the idempotency key that makes its own retries
	 * collapse.
	 */
	notify(params: {
		botId: BotId;
		connectorId: ConnectorId;
		externalAccountId: string;
		externalConversationId: string;
		text: string;
		origin?: Extract<OutboundMessageOrigin, "schedule" | "event" | "test">;
		originRunId?: RunId;
		originScheduleId?: ScheduleId;
		idempotencyKey: string;
		actor?: string;
	}): { record: OutboundMessageRecord; created: boolean } {
		this.requireOwnedConnector(params.botId, params.connectorId);
		return this.enqueue(
			{
				botId: params.botId,
				connectorId: params.connectorId,
				externalAccountId: params.externalAccountId,
				externalConversationId: params.externalConversationId,
				origin: params.origin ?? "event",
				originRunId: params.originRunId,
				originScheduleId: params.originScheduleId,
				idempotencyKey: params.idempotencyKey,
				content: params.text,
			},
			params.actor ?? "gateway",
		);
	}

	/**
	 * Constrained proactive send for agents (`send_connector_message`).
	 */
	async sendProactive(
		params: ProactiveSendParams,
	): Promise<{ record: OutboundMessageRecord; created: boolean }> {
		if (!params.text.trim()) {
			throw new ProactiveSendRejectedError("Message text must not be empty");
		}
		const originating = this.originatingDestination(params.originRunId);
		const destination = params.destination ?? originating;
		if (!destination) {
			throw new ProactiveSendRejectedError(
				"No destination: this run did not originate from a connector conversation, " +
					"so an explicit destination (connectorId + externalConversationId) is required",
			);
		}
		// The destination connector must belong to the current bot.
		this.requireOwnedConnector(params.botId, destination.connectorId);

		const isOriginating =
			originating !== undefined &&
			originating.connectorId === destination.connectorId &&
			originating.externalConversationId === destination.externalConversationId;
		const route = this.options.stores.connectorRoutes.get(
			destination.connectorId,
			destination.externalAccountId ?? originating?.externalAccountId ?? "",
			destination.externalConversationId,
		);
		if (!isOriginating) {
			// Unrelated destination: a known route (or explicit account) must
			// identify it, and an operator approval must authorize it.
			if (!route && !destination.externalAccountId) {
				throw new ProactiveSendRejectedError(
					"Unknown destination: no connector route exists for this conversation and no " +
						"explicit externalAccountId was given",
				);
			}
			if (route && route.botId !== params.botId) {
				throw new ConnectorScopeViolationError(
					`Route for that conversation belongs to bot ${route.botId}, not ${params.botId}`,
				);
			}
			await this.requireApproval(params, destination);
		}
		const externalAccountId =
			destination.externalAccountId ??
			route?.externalAccountId ??
			originating?.externalAccountId;
		if (!externalAccountId) {
			throw new ProactiveSendRejectedError(
				"Destination is missing an externalAccountId",
			);
		}

		// Per-conversation rate limit (sliding window over persisted rows).
		const limit = this.options.proactiveRateLimit ?? {
			max: 10,
			windowMs: 60_000,
		};
		const recent = this.options.stores.connectorOutbound.countRecent(
			destination.connectorId,
			destination.externalConversationId,
			"proactive",
			this.clock() - limit.windowMs,
		);
		if (recent >= limit.max) {
			throw new ProactiveSendRejectedError(
				`Proactive rate limit reached (${limit.max} messages per ${limit.windowMs}ms per conversation); retry later`,
				{ retryable: true },
			);
		}

		return this.enqueue(
			{
				botId: params.botId,
				connectorId: destination.connectorId,
				externalAccountId,
				externalConversationId: destination.externalConversationId,
				origin: "proactive",
				originRunId: params.originRunId,
				idempotencyKey: params.idempotencyKey,
				content: params.text,
			},
			params.requestedBy,
		);
	}

	// ---------------------------------------------------------------------
	// Internals
	// ---------------------------------------------------------------------

	private requireOwnedConnector(botId: BotId, connectorId: ConnectorId): void {
		// Loud bot-scoped read: mismatch throws ConnectorScopeViolationError.
		this.options.stores.connectors.getForBot(botId, connectorId);
	}

	private originatingDestination(
		runId: RunId | undefined,
	): (ConnectorDestination & { externalAccountId: string }) | undefined {
		if (!runId) {
			return undefined;
		}
		const provenance = this.options.stores.provenance.get(runId);
		if (
			provenance?.mode !== "connector" ||
			!provenance.connectorId ||
			!provenance.externalAccountId ||
			!provenance.externalConversationId
		) {
			return undefined;
		}
		return {
			connectorId: provenance.connectorId,
			externalConversationId: provenance.externalConversationId,
			externalAccountId: provenance.externalAccountId,
		};
	}

	private async requireApproval(
		params: ProactiveSendParams,
		destination: ConnectorDestination,
	): Promise<void> {
		const approvals =
			typeof this.options.approvals === "function"
				? this.options.approvals()
				: this.options.approvals;
		if (!approvals) {
			throw new ProactiveSendRejectedError(
				"Destination is not the originating conversation and no approval channel is available",
			);
		}
		const answer = (await approvals.request(
			"connector.sendApproval",
			{
				botId: params.botId,
				...(params.originRunId ? { runId: params.originRunId } : {}),
			},
			{
				connectorId: destination.connectorId,
				externalConversationId: destination.externalConversationId,
				...(destination.externalAccountId
					? { externalAccountId: destination.externalAccountId }
					: {}),
				textPreview: params.text.slice(0, 280),
			},
		)) as { approved?: unknown; reason?: unknown } | null;
		if (answer?.approved !== true) {
			throw new ProactiveSendRejectedError(
				`Proactive send to an unrelated destination was not approved${
					typeof answer?.reason === "string" ? `: ${answer.reason}` : ""
				}`,
			);
		}
	}

	private enqueue(
		params: EnqueueOutboundParams,
		actor: string,
	): { record: OutboundMessageRecord; created: boolean } {
		const result = this.options.database.transaction(() => {
			const enqueued = this.options.stores.connectorOutbound.enqueue(
				params,
				this.clock(),
			);
			if (enqueued.created) {
				this.options.stores.events.append(
					"connector.outboundEnqueued",
					{
						botId: params.botId,
						...(params.originRunId ? { runId: params.originRunId } : {}),
					},
					{
						outboundId: enqueued.record.outboundId,
						connectorId: params.connectorId,
						externalConversationId: params.externalConversationId,
						origin: params.origin,
					},
					this.clock(),
				);
				this.options.stores.audit.record(
					actor,
					"connector.outboundEnqueued",
					enqueued.record.outboundId,
					{
						connectorId: params.connectorId,
						origin: params.origin,
					},
					this.clock(),
				);
			}
			return enqueued;
		});
		if (result.created) {
			this.options.onEnqueued?.();
		}
		return result;
	}
}
