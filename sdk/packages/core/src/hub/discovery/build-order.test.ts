import { describe, expect, it } from "vitest";
import {
	compareHubBuilds,
	type HubBuildIdentity,
	isManagedHubReusable,
} from ".";

/**
 * Every shape a discovered Hub record has taken across releases, including the
 * ones that caused the mutual-retire loop: pre-fingerprint daemons with no
 * build metadata at all, and fingerprinted daemons from before build epochs
 * were embedded.
 */
const BUILD_CORPUS: HubBuildIdentity[] = [
	{},
	{ buildId: "0.0.54" },
	{ buildId: "0.0.64" },
	{ buildId: "0.0.74" },
	{ coreVersion: "0.0.64" },
	{ coreVersion: "0.0.74" },
	{ buildId: "0.0.64", coreVersion: "0.0.64" },
	{ buildId: "0.0.74", coreVersion: "0.0.74" },
	{ buildId: "abc123", coreVersion: "0.0.74" },
	{ buildId: "def456", coreVersion: "0.0.74" },
	{ buildId: "0.0.74", buildEpochMs: 1_000 },
	{ buildId: "0.0.75", buildEpochMs: 2_000 },
	{ buildId: "0.0.75", buildEpochMs: 2_000, coreVersion: "0.0.75" },
	{ buildId: "source-0.0.74", coreVersion: "0.0.74" },
	{ buildId: "0.0.74", buildEpochMs: Number.NaN },
	{ buildId: "0.0.74", buildEpochMs: 0 },
	{ buildId: " ", coreVersion: "not-a-version" },
	{ coreVersion: "3.0.50-nightly.1785933782" },
	{ coreVersion: "3.0.50" },
];

/**
 * The subset a healthy daemon actually publishes: build id, epoch, and core
 * version all present.
 */
const FULL_BUILD_CORPUS: HubBuildIdentity[] = [
	{ buildId: "a", buildEpochMs: 1_000, coreVersion: "0.0.64" },
	{ buildId: "b", buildEpochMs: 2_000, coreVersion: "0.0.74" },
	{ buildId: "c", buildEpochMs: 2_000, coreVersion: "0.0.75" },
	{ buildId: "d", buildEpochMs: 3_000, coreVersion: "0.0.64" },
	{ buildId: "e", buildEpochMs: 3_000, coreVersion: "0.0.64" },
];

const PROTOCOL = { protocolVersion: "v1" } as const;

function retires(mine: HubBuildIdentity, theirs: HubBuildIdentity): boolean {
	return !isManagedHubReusable({ ...PROTOCOL, ...theirs }, { self: mine });
}

describe("compareHubBuilds", () => {
	it("is reflexive over the corpus", () => {
		for (const build of BUILD_CORPUS) {
			expect(compareHubBuilds(build, build)).toBe(0);
		}
	});

	it("is antisymmetric over every pair in the corpus", () => {
		for (const a of BUILD_CORPUS) {
			for (const b of BUILD_CORPUS) {
				expect(
					Math.sign(compareHubBuilds(a, b)) + Math.sign(compareHubBuilds(b, a)),
				).toBe(0);
			}
		}
	});

	/**
	 * Transitivity only holds where every record carries the same fields: a
	 * tier is skipped when either side lacks it, so partial metadata makes
	 * "indistinguishable" a non-transitive relation. Antisymmetry - the
	 * property that actually prevents the retire loop - holds regardless, and
	 * is asserted over the full corpus above.
	 */
	it("is transitive over fully populated identities", () => {
		for (const a of FULL_BUILD_CORPUS) {
			for (const b of FULL_BUILD_CORPUS) {
				for (const c of FULL_BUILD_CORPUS) {
					if (compareHubBuilds(a, b) < 0 && compareHubBuilds(b, c) < 0) {
						expect(compareHubBuilds(a, c)).toBeLessThan(0);
					}
				}
			}
		}
	});

	it("orders by build epoch before core version", () => {
		expect(
			compareHubBuilds(
				{ buildId: "a", buildEpochMs: 1_000, coreVersion: "9.9.9" },
				{ buildId: "b", buildEpochMs: 2_000, coreVersion: "0.0.1" },
			),
		).toBeLessThan(0);
	});

	it("falls back to core version when epochs are absent or tied", () => {
		expect(
			compareHubBuilds({ coreVersion: "0.0.64" }, { coreVersion: "0.0.74" }),
		).toBeLessThan(0);
		expect(
			compareHubBuilds(
				{ buildId: "a", buildEpochMs: 5, coreVersion: "0.0.64" },
				{ buildId: "b", buildEpochMs: 5, coreVersion: "0.0.74" },
			),
		).toBeLessThan(0);
	});

	it("treats records with no comparable metadata as indistinguishable", () => {
		expect(compareHubBuilds({}, {})).toBe(0);
		expect(compareHubBuilds({}, { buildId: "0.0.74" })).toBe(0);
	});
});

describe("isManagedHubReusable", () => {
	/**
	 * The regression guard for the mutual-retire loop: two installations, each
	 * evaluating the other's Hub, must never both decide to retire.
	 */
	it("never lets two builds retire each other", () => {
		for (const a of BUILD_CORPUS) {
			for (const b of BUILD_CORPUS) {
				expect(retires(a, b) && retires(b, a)).toBe(false);
			}
		}
	});

	it("reuses a Hub built from the same build id", () => {
		const build = { buildId: "0.0.74", coreVersion: "0.0.74" };
		expect(retires(build, build)).toBe(false);
	});

	it("retires a strictly older Hub", () => {
		expect(
			retires(
				{ buildId: "0.0.74", coreVersion: "0.0.74" },
				{ buildId: "0.0.64", coreVersion: "0.0.64" },
			),
		).toBe(true);
	});

	it("attaches to a strictly newer Hub instead of downgrading it", () => {
		expect(
			retires(
				{ buildId: "0.0.64", coreVersion: "0.0.64" },
				{ buildId: "0.0.74", coreVersion: "0.0.74" },
			),
		).toBe(false);
	});

	it("attaches to a Hub with no build metadata rather than retiring it", () => {
		expect(retires({ buildId: "0.0.74" }, {})).toBe(false);
	});

	it("still replaces a protocol-incompatible Hub", () => {
		expect(
			isManagedHubReusable(
				{ protocolVersion: "v99", buildId: "0.0.64" },
				{ self: { buildId: "0.0.74" } },
			),
		).toBe(false);
	});
});
