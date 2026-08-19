/**
 * Gateway-internal command registry (Gateway RFC, Phase 0).
 *
 * Reusable wire schemas (envelopes, IDs, errors) live in
 * `@cline/shared/gateway`; the per-method command surface stays private to
 * the Gateway. Every mutating method requires an idempotency key. Adding a
 * method is an additive protocol change.
 */

import {
	BotIdSchema,
	ConnectorIdSchema,
	createGatewayError,
	GATEWAY_HELLO_METHOD,
	type GatewayError,
	GatewayHelloParamsSchema,
	type GatewayRequest,
	GatewayRequestSchema,
	IDEMPOTENCY_KEY_PARAM,
	IdempotencyKeySchema,
	RunIdSchema,
	ScheduleIdSchema,
	SessionIdSchema,
} from "@cline/shared/gateway";
import { z } from "zod";

const IdempotentParamsBase = z.object({
	[IDEMPOTENCY_KEY_PARAM]: IdempotencyKeySchema,
});

const StatisticsDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export interface GatewayMethodDefinition {
	readonly method: string;
	/** Mutating methods require an idempotency key in params. */
	readonly mutating: boolean;
	readonly params: z.ZodType<unknown>;
}

const TurnOverridesSchema = z
	.object({
		providerId: z.string().min(1).optional(),
		modelId: z.string().min(1).optional(),
		systemPrompt: z.string().optional(),
		maxIterations: z.number().int().positive().optional(),
	})
	.strict();

function define(
	method: string,
	mutating: boolean,
	params: z.ZodType<unknown>,
): GatewayMethodDefinition {
	return { method, mutating, params };
}

/**
 * Protocol v1 command surface. `run.start` acks immediately with
 * `{runId, acceptedAt, queuePosition}` — it never stays open for the turn.
 */
export const GATEWAY_METHODS: readonly GatewayMethodDefinition[] = [
	define(GATEWAY_HELLO_METHOD, false, GatewayHelloParamsSchema),
	define("gateway.status", false, z.object({}).strict().optional()),
	define(
		"gateway.drain",
		true,
		IdempotentParamsBase.extend({
			reason: z.string().optional(),
		}).strict(),
	),
	define(
		"gateway.stop",
		true,
		IdempotentParamsBase.extend({
			reason: z.string().optional(),
		}).strict(),
	),
	define(
		"run.start",
		true,
		IdempotentParamsBase.extend({
			botId: BotIdSchema,
			prompt: z.string().min(1),
			/**
			 * Target session (canonical by default). Desktop names a
			 * connector conversation's dedicated session here to join it
			 * intentionally.
			 */
			sessionId: SessionIdSchema.optional(),
			workspaceRoot: z.string().min(1).optional(),
			overrides: TurnOverridesSchema.optional(),
		}).strict(),
	),
	define(
		"run.steer",
		true,
		IdempotentParamsBase.extend({
			runId: RunIdSchema,
			text: z.string().min(1),
		}).strict(),
	),
	define(
		"run.interrupt",
		true,
		IdempotentParamsBase.extend({
			runId: RunIdSchema,
			reason: z.string().optional(),
		}).strict(),
	),
	define(
		"run.abort",
		true,
		IdempotentParamsBase.extend({
			runId: RunIdSchema,
			reason: z.string().optional(),
		}).strict(),
	),
	define(
		"run.subscribe",
		false,
		z
			.object({
				sessionId: SessionIdSchema.optional(),
				runId: RunIdSchema.optional(),
				/** Opaque replay cursor from `@cline/shared/gateway`. */
				cursor: z.string().optional(),
			})
			.strict(),
	),
	define(
		"bot.delegate",
		true,
		IdempotentParamsBase.extend({
			parentBotId: BotIdSchema,
			name: z.string().min(1),
			role: z.enum(["worker", "contractor"]),
			reason: z.string().optional(),
		}).strict(),
	),
	define("bot.list", false, z.object({}).strict().optional()),
	define(
		"session.list",
		false,
		z.object({ botId: BotIdSchema.optional() }).strict().optional(),
	),
	define(
		"run.list",
		false,
		z
			.object({
				sessionId: SessionIdSchema.optional(),
				runId: RunIdSchema.optional(),
			})
			.strict()
			.optional(),
	),
	// Statistics read surface (bounded aggregate queries; the equivalents
	// of GET /statistics/{summary,activity,rankings,usage} for clients).
	define(
		"statistics.summary",
		false,
		z
			.object({
				from: StatisticsDateSchema.optional(),
				to: StatisticsDateSchema.optional(),
			})
			.strict()
			.optional(),
	),
	define(
		"statistics.activity",
		false,
		z
			.object({
				from: StatisticsDateSchema.optional(),
				to: StatisticsDateSchema.optional(),
			})
			.strict()
			.optional(),
	),
	define(
		"statistics.rankings",
		false,
		z
			.object({
				dimension: z.enum(["model", "agent", "topic"]),
				from: StatisticsDateSchema.optional(),
				to: StatisticsDateSchema.optional(),
				limit: z.number().int().min(1).max(100).optional(),
			})
			.strict(),
	),
	define(
		"statistics.usage",
		false,
		z
			.object({
				/** Calendar month, e.g. `2026-08`. */
				month: z.string().regex(/^\d{4}-\d{2}$/),
			})
			.strict(),
	),
	// Phase 6: connectors are bot-scoped; registration names exactly one bot.
	define(
		"connector.register",
		true,
		IdempotentParamsBase.extend({
			botId: BotIdSchema,
			kind: z.enum(["telegram", "slack"]),
			name: z.string().min(1),
			config: z.record(z.string(), z.unknown()).optional(),
			/** Name of an owner-only secret file — never the secret itself. */
			credentialRef: z.string().min(1).optional(),
		}).strict(),
	),
	define(
		"connector.list",
		false,
		z.object({ botId: BotIdSchema.optional() }).strict().optional(),
	),
	define(
		"connector.inspect",
		false,
		z.object({ connectorId: ConnectorIdSchema }).strict(),
	),
	define(
		"connector.setEnabled",
		true,
		IdempotentParamsBase.extend({
			connectorId: ConnectorIdSchema,
			enabled: z.boolean(),
		}).strict(),
	),
	define(
		"connector.updateConfig",
		true,
		IdempotentParamsBase.extend({
			connectorId: ConnectorIdSchema,
			/** Non-secret configuration only; secret-like keys are refused. */
			config: z.record(z.string(), z.unknown()),
		}).strict(),
	),
	define(
		"connector.setCredential",
		true,
		IdempotentParamsBase.extend({
			connectorId: ConnectorIdSchema,
			/** Secret FILE reference; omitted clears it. Never a token. */
			credentialRef: z.string().min(1).optional(),
		}).strict(),
	),
	define(
		"connector.remove",
		true,
		IdempotentParamsBase.extend({
			connectorId: ConnectorIdSchema,
		}).strict(),
	),
	define(
		"connector.routes",
		false,
		z.object({ connectorId: ConnectorIdSchema }).strict(),
	),
	define(
		"connector.testCredentials",
		false,
		z.object({ connectorId: ConnectorIdSchema }).strict(),
	),
	define(
		"connector.sendTest",
		true,
		IdempotentParamsBase.extend({
			connectorId: ConnectorIdSchema,
			externalConversationId: z.string().min(1),
			externalAccountId: z.string().min(1).optional(),
			text: z.string().min(1).optional(),
		}).strict(),
	),
	define(
		"connector.outbound",
		false,
		z
			.object({
				connectorId: ConnectorIdSchema.optional(),
				botId: BotIdSchema.optional(),
				state: z.enum(["pending", "sending", "delivered", "failed"]).optional(),
				limit: z.number().int().min(1).max(500).optional(),
			})
			.strict()
			.optional(),
	),
	// Phase 6: schedules — durable triggers creating ordinary automation runs.
	define(
		"schedule.create",
		true,
		IdempotentParamsBase.extend({
			botId: BotIdSchema,
			name: z.string().min(1),
			prompt: z.string().min(1),
			intervalMs: z.number().int().positive().optional(),
			at: z.number().int().nonnegative().optional(),
			maxAttempts: z.number().int().positive().optional(),
			/** Deliver firing outcomes to a connector conversation. */
			notify: z
				.object({
					connectorId: ConnectorIdSchema,
					externalAccountId: z.string().min(1),
					externalConversationId: z.string().min(1),
				})
				.strict()
				.optional(),
		}).strict(),
	),
	define(
		"schedule.list",
		false,
		z.object({ botId: BotIdSchema.optional() }).strict().optional(),
	),
	define(
		"schedule.report",
		false,
		z.object({ scheduleId: ScheduleIdSchema }).strict(),
	),
];

const METHODS_BY_NAME = new Map(
	GATEWAY_METHODS.map((definition) => [definition.method, definition]),
);

export function getMethodDefinition(
	method: string,
): GatewayMethodDefinition | undefined {
	return METHODS_BY_NAME.get(method);
}

export type ValidatedGatewayRequest =
	| {
			ok: true;
			request: GatewayRequest;
			definition: GatewayMethodDefinition;
			params: unknown;
	  }
	| { ok: false; error: GatewayError };

/**
 * Validate a raw inbound value against the envelope, the method registry,
 * the idempotency requirement, and the method's param schema.
 */
export function validateGatewayRequest(
	value: unknown,
): ValidatedGatewayRequest {
	const envelope = GatewayRequestSchema.safeParse(value);
	if (!envelope.success) {
		return {
			ok: false,
			error: createGatewayError(
				"invalid_request",
				`Malformed request envelope: ${envelope.error.issues[0]?.message ?? "unknown"}`,
			),
		};
	}
	const definition = METHODS_BY_NAME.get(envelope.data.method);
	if (!definition) {
		return {
			ok: false,
			error: createGatewayError(
				"not_found",
				`Unknown method: ${envelope.data.method}`,
			),
		};
	}
	if (definition.mutating) {
		const key = envelope.data.params?.[IDEMPOTENCY_KEY_PARAM];
		if (!IdempotencyKeySchema.safeParse(key).success) {
			return {
				ok: false,
				error: createGatewayError(
					"idempotency_key_required",
					`Mutating method ${definition.method} requires a valid "${IDEMPOTENCY_KEY_PARAM}" param`,
				),
			};
		}
	}
	const params = definition.params.safeParse(envelope.data.params);
	if (!params.success) {
		return {
			ok: false,
			error: createGatewayError(
				"invalid_request",
				`Invalid params for ${definition.method}: ${params.error.issues[0]?.message ?? "unknown"}`,
			),
		};
	}
	return {
		ok: true,
		request: envelope.data,
		definition,
		params: params.data,
	};
}
