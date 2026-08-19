import { createIdempotencyKey } from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import { IdempotencyLedger, stableStringify } from "./idempotency-ledger";

describe("stableStringify", () => {
	it("is key-order independent", () => {
		expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
			stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
		);
	});
});

describe("IdempotencyLedger", () => {
	it("executes new keys, replays recorded outcomes, and reports pending", () => {
		const ledger = new IdempotencyLedger();
		const key = createIdempotencyKey();
		const params = { botId: "bot_deadbeef", prompt: "go" };

		expect(ledger.begin(key, "run.start", params)).toEqual({ kind: "new" });
		// Same request again before the mutation finished: pending.
		expect(ledger.begin(key, "run.start", params)).toEqual({ kind: "pending" });

		const response = { version: 1 as const, id: "req_1", result: { ok: true } };
		ledger.record(key, response);
		const replay = ledger.begin(key, "run.start", { ...params });
		expect(replay.kind).toBe("replay");
		if (replay.kind === "replay") {
			expect(replay.response).toEqual(response);
		}
	});

	it("conflicts when a key is reused with a different method or params", () => {
		const ledger = new IdempotencyLedger();
		const key = createIdempotencyKey();
		ledger.begin(key, "run.start", { prompt: "go" });

		const differentMethod = ledger.begin(key, "run.abort", { prompt: "go" });
		expect(differentMethod.kind).toBe("conflict");
		if (differentMethod.kind === "conflict") {
			expect(differentMethod.error.code).toBe("idempotency_conflict");
		}

		const differentParams = ledger.begin(key, "run.start", { prompt: "stop" });
		expect(differentParams.kind).toBe("conflict");
	});

	it("refuses to record outcomes for keys that never began", () => {
		const ledger = new IdempotencyLedger();
		expect(() =>
			ledger.record(createIdempotencyKey(), {
				version: 1,
				id: "req_x",
				result: {},
			}),
		).toThrow();
	});
});
