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
	createGatewayError,
	GATEWAY_HELLO_METHOD,
	type GatewayError,
	GatewayHelloParamsSchema,
	type GatewayRequest,
	GatewayRequestSchema,
	IDEMPOTENCY_KEY_PARAM,
	IdempotencyKeySchema,
	RunIdSchema,
	SessionIdSchema,
} from "@cline/shared/gateway";
import { z } from "zod";

const IdempotentParamsBase = z.object({
	[IDEMPOTENCY_KEY_PARAM]: IdempotencyKeySchema,
});

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
