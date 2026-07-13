import { describe, expect, it } from "bun:test";
import { decideBundle, nextCachedBundle } from "./cohort";

const base = {
	override: undefined,
	cached: undefined,
	killswitch: false,
	previousFailure: false,
};

describe("decideBundle", () => {
	it("defaults to legacy with no cached assignment", () => {
		expect(decideBundle(base)).toBe("legacy");
	});

	it("uses the cached assignment", () => {
		expect(decideBundle({ ...base, cached: "next" })).toBe("next");
		expect(decideBundle({ ...base, cached: "legacy" })).toBe("legacy");
	});

	it("treats unknown cached values as legacy", () => {
		expect(decideBundle({ ...base, cached: "garbage" })).toBe("legacy");
	});

	it("kill-switch forces legacy even when cached next", () => {
		expect(decideBundle({ ...base, cached: "next", killswitch: true })).toBe(
			"legacy",
		);
	});

	it("a previous activation failure on this version forces legacy", () => {
		expect(
			decideBundle({ ...base, cached: "next", previousFailure: true }),
		).toBe("legacy");
	});

	it("env override beats everything, including kill-switch", () => {
		expect(
			decideBundle({
				...base,
				override: "next",
				killswitch: true,
				previousFailure: true,
			}),
		).toBe("next");
		expect(decideBundle({ ...base, override: "legacy", cached: "next" })).toBe(
			"legacy",
		);
	});

	it("ignores invalid overrides", () => {
		expect(decideBundle({ ...base, override: "beta", cached: "next" })).toBe(
			"next",
		);
	});
});

describe("nextCachedBundle", () => {
	it("promotes into the cohort when the rollout flag is on", () => {
		expect(
			nextCachedBundle(undefined, { rollout: true, killswitch: false }),
		).toBe("next");
	});

	it("stays legacy when the rollout flag is off", () => {
		expect(
			nextCachedBundle(undefined, { rollout: false, killswitch: false }),
		).toBe("legacy");
		expect(
			nextCachedBundle("legacy", { rollout: false, killswitch: false }),
		).toBe("legacy");
	});

	it("is one-way: dialing the percentage down never demotes an assigned machine", () => {
		expect(
			nextCachedBundle("next", { rollout: false, killswitch: false }),
		).toBe("next");
	});

	it("kill-switch demotes everyone", () => {
		expect(nextCachedBundle("next", { rollout: true, killswitch: true })).toBe(
			"legacy",
		);
		expect(
			nextCachedBundle("legacy", { rollout: true, killswitch: true }),
		).toBe("legacy");
	});
});
