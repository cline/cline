/**
 * Idempotency contract (Gateway RFC, Phase 0).
 *
 * Every mutating request carries an idempotency key. Replaying a key with
 * the same method returns the recorded outcome; replaying it with a
 * different method (or materially different params) is an
 * `idempotency_conflict`. Keys are client-generated.
 */

import { z } from "zod";

/** Name of the params field carrying the key on mutating requests. */
export const IDEMPOTENCY_KEY_PARAM = "idempotencyKey";

export const IdempotencyKeySchema = z
	.string()
	.min(8)
	.max(128)
	.regex(
		/^[A-Za-z0-9_-]+$/,
		"Idempotency keys are URL-safe tokens of 8-128 characters",
	);

export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

export function createIdempotencyKey(
	random: () => string = () => globalThis.crypto.randomUUID(),
): IdempotencyKey {
	return IdempotencyKeySchema.parse(random().replaceAll("-", ""));
}
