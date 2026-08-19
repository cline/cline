/**
 * In-memory idempotency ledger (Gateway RFC, Phase 0).
 *
 * Pure bookkeeping, no persistence (a durable ledger arrives with the
 * Phase 3 SQLite authority behind the same interface): replaying a key
 * with the same method+params returns the recorded response; replaying it
 * with different method or params is a conflict.
 */

import type { GatewayError } from "@cline/shared/gateway";
import {
	createGatewayError,
	type GatewayResponse,
	type IdempotencyKey,
} from "@cline/shared/gateway";

export type IdempotencyBeginOutcome =
	| { kind: "new" }
	| { kind: "pending" }
	| { kind: "replay"; response: GatewayResponse }
	| { kind: "conflict"; error: GatewayError };

interface LedgerEntry {
	method: string;
	paramsFingerprint: string;
	response?: GatewayResponse;
}

/** Deterministic JSON with sorted object keys. */
export function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entryValue]) => entryValue !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(
				([key, entryValue]) =>
					`${JSON.stringify(key)}:${stableStringify(entryValue)}`,
			);
		return `{${entries.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

export class IdempotencyLedger {
	private readonly entries = new Map<IdempotencyKey, LedgerEntry>();

	/**
	 * Begin a mutating request. Callers execute the mutation only for
	 * `new`; `replay` short-circuits with the recorded response; `pending`
	 * means the original request is still executing.
	 */
	begin(
		key: IdempotencyKey,
		method: string,
		params: unknown,
	): IdempotencyBeginOutcome {
		const fingerprint = stableStringify(params ?? null);
		const existing = this.entries.get(key);
		if (!existing) {
			this.entries.set(key, { method, paramsFingerprint: fingerprint });
			return { kind: "new" };
		}
		if (
			existing.method !== method ||
			existing.paramsFingerprint !== fingerprint
		) {
			return {
				kind: "conflict",
				error: createGatewayError(
					"idempotency_conflict",
					`Idempotency key reused with a different ${
						existing.method !== method ? "method" : "params payload"
					} (original: ${existing.method})`,
					{ retryable: false },
				),
			};
		}
		if (!existing.response) {
			return { kind: "pending" };
		}
		return { kind: "replay", response: existing.response };
	}

	/** Record the outcome of a mutation begun with `begin`. */
	record(key: IdempotencyKey, response: GatewayResponse): void {
		const entry = this.entries.get(key);
		if (!entry) {
			throw new Error(
				"IdempotencyLedger.record called for a key that never began",
			);
		}
		entry.response = response;
	}

	get size(): number {
		return this.entries.size;
	}
}
