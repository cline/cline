/**
 * Gateway protocol envelopes (Gateway RFC, Phase 0).
 *
 * One versioned protocol for desktop, CLI, connector, local, and remote
 * clients. Three independent wire shapes:
 *
 * - `GatewayRequest` / `GatewayResponse`: client-initiated RPC, correlated
 *   by `id`. `run.start` acks immediately; it never stays open for a turn.
 * - `GatewayEvent`: server-pushed progress, ordered by `sequence` within a
 *   connection subscription and scoped to bot/session/run.
 * - Server requests (see `server-requests.ts`): server-initiated questions
 *   (approvals, credentials) that are NOT events and carry their own `id`.
 *
 * Protocol evolution is additive: unknown envelope fields are rejected
 * (strict schemas define the compatibility surface per version), while
 * unknown event names and capabilities are tolerated by clients.
 */

import { z } from "zod";
import { GatewayErrorSchema } from "./errors";
import { BotIdSchema, RunIdSchema, SessionIdSchema } from "./ids";

/** Current (and only) protocol version. */
export const GATEWAY_PROTOCOL_VERSION = 1 as const;

/** Dotted lowerCamel segments, e.g. `gateway.hello`, `run.start`. */
export const GATEWAY_METHOD_PATTERN =
	/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

export const GatewayRequestSchema = z
	.object({
		version: z.literal(GATEWAY_PROTOCOL_VERSION),
		id: z.string().min(1),
		method: z.string().regex(GATEWAY_METHOD_PATTERN),
		params: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export type GatewayRequest = z.infer<typeof GatewayRequestSchema>;

export const GatewayResponseSchema = z
	.object({
		version: z.literal(GATEWAY_PROTOCOL_VERSION),
		id: z.string().min(1),
		result: z.unknown().optional(),
		error: GatewayErrorSchema.optional(),
	})
	.strict()
	.refine(
		(value) => (value.result === undefined) !== (value.error === undefined),
		{
			message: "A response carries exactly one of `result` or `error`",
		},
	);

export type GatewayResponse = z.infer<typeof GatewayResponseSchema>;

export const GatewayEventScopeSchema = z
	.object({
		botId: BotIdSchema.optional(),
		sessionId: SessionIdSchema.optional(),
		runId: RunIdSchema.optional(),
	})
	.strict();

export type GatewayEventScope = z.infer<typeof GatewayEventScopeSchema>;

export const GatewayEventSchema = z
	.object({
		version: z.literal(GATEWAY_PROTOCOL_VERSION),
		sequence: z.number().int().nonnegative(),
		event: z.string().regex(GATEWAY_METHOD_PATTERN),
		scope: GatewayEventScopeSchema,
		payload: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export type GatewayEvent = z.infer<typeof GatewayEventSchema>;
