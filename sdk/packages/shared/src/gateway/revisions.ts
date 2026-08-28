/**
 * Revisions for optimistic concurrency (Gateway RFC, Phase 0).
 *
 * Gateway-owned mutable records (bot registry entries, session metadata,
 * configs) carry a monotonically increasing revision. Mutations state the
 * revision they were computed against; a mismatch is a `revision_conflict`
 * and the client must reload before retrying.
 */

import { z } from "zod";
import { createGatewayError, type GatewayError } from "./errors";

export const RevisionSchema = z.number().int().nonnegative();

export type Revision = z.infer<typeof RevisionSchema>;

export const INITIAL_REVISION: Revision = 0;

export function nextRevision(revision: Revision): Revision {
	return RevisionSchema.parse(revision + 1);
}

/**
 * Returns a `revision_conflict` error when `expected` does not match
 * `actual`, or `undefined` when the mutation may proceed.
 */
export function checkRevision(
	expected: Revision,
	actual: Revision,
): GatewayError | undefined {
	if (expected === actual) {
		return undefined;
	}
	return createGatewayError(
		"revision_conflict",
		`Revision mismatch: expected ${expected}, actual ${actual}`,
		{ retryable: false, details: { expected, actual } },
	);
}
