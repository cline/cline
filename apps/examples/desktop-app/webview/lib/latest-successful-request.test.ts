import { describe, expect, it } from "vitest";
import { createLatestSuccessfulRequestGate } from "./latest-successful-request";

describe("createLatestSuccessfulRequestGate", () => {
	it("allows an earlier successful request to commit when a newer request fails", () => {
		const gate = createLatestSuccessfulRequestGate();
		const successfulRequest = gate.begin();
		gate.begin();

		expect(gate.commit(successfulRequest)).toBe(true);
	});

	it("rejects a successful result older than the latest committed result", () => {
		const gate = createLatestSuccessfulRequestGate();
		const olderRequest = gate.begin();
		const newerRequest = gate.begin();

		expect(gate.commit(newerRequest)).toBe(true);
		expect(gate.commit(olderRequest)).toBe(false);
	});

	it("rejects in-flight results after an explicit invalidation", () => {
		const gate = createLatestSuccessfulRequestGate();
		const staleRequest = gate.begin();

		gate.invalidate();

		expect(gate.commit(staleRequest)).toBe(false);
		expect(gate.commit(gate.begin())).toBe(true);
	});
});
