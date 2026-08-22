import { describe, expect, it } from "vitest";
import {
	CatalogGenerationSchema,
	createBotId,
	createRunId,
	createSessionId,
	ID_CONTRACTS,
} from "./ids";

describe("gateway ID contracts", () => {
	it("uses a distinct prefix per ID kind", () => {
		const prefixes = Object.values(ID_CONTRACTS).map(
			(contract) => contract.prefix,
		);
		expect(new Set(prefixes).size).toBe(prefixes.length);
	});

	it("creates IDs that round-trip through their own schema", () => {
		for (const contract of Object.values(ID_CONTRACTS)) {
			const id = contract.create();
			expect(contract.is(id)).toBe(true);
			expect(contract.parse(id)).toBe(id);
			expect(id.startsWith(`${contract.prefix}_`)).toBe(true);
		}
	});

	it("IDs are not interchangeable: every schema rejects every other kind", () => {
		const entries = Object.entries(ID_CONTRACTS);
		for (const [kind, contract] of entries) {
			const id = contract.create();
			for (const [otherKind, otherContract] of entries) {
				if (otherKind === kind) {
					continue;
				}
				expect(otherContract.is(id), `${otherKind} accepted a ${kind}`).toBe(
					false,
				);
				expect(() => otherContract.parse(id)).toThrow();
			}
		}
	});

	it("rejects malformed bodies", () => {
		for (const contract of Object.values(ID_CONTRACTS)) {
			expect(contract.is(`${contract.prefix}_`)).toBe(false);
			expect(contract.is(`${contract.prefix}_short`)).toBe(false);
			expect(contract.is(`${contract.prefix}_has spaces here!`)).toBe(false);
			expect(contract.is(`${contract.prefix}_${"x".repeat(65)}`)).toBe(false);
			expect(contract.is(42)).toBe(false);
			expect(contract.is(undefined)).toBe(false);
		}
	});

	it("supports injected entropy sources", () => {
		expect(createBotId(() => "deadbeef")).toBe("bot_deadbeef");
		expect(createSessionId(() => "deadbeef")).toBe("ses_deadbeef");
		expect(createRunId(() => "deadbeef")).toBe("run_deadbeef");
		expect(() => createBotId(() => "bad body!")).toThrow();
	});

	it("catalogGeneration is a monotonic number, not an ID", () => {
		expect(CatalogGenerationSchema.parse(0)).toBe(0);
		expect(CatalogGenerationSchema.parse(41)).toBe(41);
		expect(() => CatalogGenerationSchema.parse(-1)).toThrow();
		expect(() => CatalogGenerationSchema.parse("cat_deadbeef")).toThrow();
		expect(() => CatalogGenerationSchema.parse(1.5)).toThrow();
	});
});
