/**
 * Gateway wire error contract (Gateway RFC, Phase 0).
 *
 * Every failed request resolves to exactly one `GatewayError`. Codes are a
 * closed set per protocol version; adding a code is an additive protocol
 * change. `retryable` tells clients whether the same request (same
 * idempotency key) may be retried against the same Gateway.
 */

import { z } from "zod";

export const GATEWAY_ERROR_CODES = [
	/** Envelope or params failed schema validation. */
	"invalid_request",
	/** No protocol version shared between client and Gateway. */
	"protocol_version_unsupported",
	/** A request other than `gateway.hello` arrived before the handshake. */
	"handshake_required",
	/** Principal is not allowed to perform the request. */
	"unauthorized",
	/** Referenced bot/session/run/worker does not exist for this principal. */
	"not_found",
	/** A mutating method was called without an idempotency key. */
	"idempotency_key_required",
	/** An idempotency key was reused with a different method or params. */
	"idempotency_conflict",
	/** Optimistic concurrency check failed; reload and retry. */
	"revision_conflict",
	/** Run admission rejected the prompt (no session is created). */
	"run_admission_rejected",
	/** Attempted transition violates the run/session state machine. */
	"invalid_state_transition",
	/**
	 * The selected Gateway cannot be reached. Clients MUST surface this
	 * error; falling back to an implicit in-process runtime is forbidden
	 * (see `GATEWAY_CONNECT_FALLBACK`).
	 */
	"gateway_unreachable",
	/** Gateway is draining and refuses new mutating work. */
	"gateway_draining",
	/** Unexpected server-side failure. */
	"internal",
] as const;

export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number];

export const GatewayErrorSchema = z
	.object({
		code: z.enum(GATEWAY_ERROR_CODES),
		message: z.string().min(1),
		retryable: z.boolean().optional(),
		details: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export type GatewayError = z.infer<typeof GatewayErrorSchema>;

export function createGatewayError(
	code: GatewayErrorCode,
	message: string,
	options: { retryable?: boolean; details?: Record<string, unknown> } = {},
): GatewayError {
	return GatewayErrorSchema.parse({
		code,
		message,
		...(options.retryable !== undefined
			? { retryable: options.retryable }
			: {}),
		...(options.details !== undefined ? { details: options.details } : {}),
	});
}
