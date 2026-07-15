import { describe, expect, it } from "bun:test";
import {
	bundleContextKey,
	compareVersions,
	decideBundle,
	decisionOverrideSource,
	idPrefix,
	isVersionKilled,
	KILLSWITCH_FLAG,
	nextCachedBundle,
	normalizeKilledUpTo,
	parseRolloutFlags,
	ROLLOUT_FLAG,
	settingSection,
} from "./cohort";

const base = {
	envOverride: undefined,
	settingOverride: undefined,
	cached: undefined,
	killedUpToVersion: undefined,
	previousFailure: false,
	version: "4.1.0",
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

	it("kill-switch scoped to this version forces legacy even when cached next", () => {
		expect(
			decideBundle({ ...base, cached: "next", killedUpToVersion: "4.1.0" }),
		).toBe("legacy");
		expect(
			decideBundle({ ...base, cached: "next", killedUpToVersion: "*" }),
		).toBe("legacy");
	});

	it("kill-switch scoped below this version does not apply", () => {
		expect(
			decideBundle({ ...base, cached: "next", killedUpToVersion: "4.0.9" }),
		).toBe("next");
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
				envOverride: "next",
				killedUpToVersion: "*",
				previousFailure: true,
			}),
		).toBe("next");
		expect(
			decideBundle({ ...base, envOverride: "legacy", cached: "next" }),
		).toBe("legacy");
	});

	it("user setting overrides in both directions and beats the kill-switch", () => {
		expect(
			decideBundle({
				...base,
				settingOverride: "next",
				killedUpToVersion: "*",
				previousFailure: true,
			}),
		).toBe("next");
		expect(
			decideBundle({ ...base, settingOverride: "legacy", cached: "next" }),
		).toBe("legacy");
	});

	it("env override beats the user setting", () => {
		expect(
			decideBundle({ ...base, envOverride: "legacy", settingOverride: "next" }),
		).toBe("legacy");
	});

	it("ignores invalid and 'auto' overrides", () => {
		expect(decideBundle({ ...base, envOverride: "beta", cached: "next" })).toBe(
			"next",
		);
		expect(
			decideBundle({ ...base, settingOverride: "auto", cached: "next" }),
		).toBe("next");
	});
});

describe("decisionOverrideSource", () => {
	it("reports which override was active", () => {
		expect(decisionOverrideSource(base)).toBeUndefined();
		expect(decisionOverrideSource({ ...base, settingOverride: "next" })).toBe(
			"setting",
		);
		expect(
			decisionOverrideSource({
				...base,
				envOverride: "legacy",
				settingOverride: "next",
			}),
		).toBe("env");
		expect(
			decisionOverrideSource({ ...base, settingOverride: "auto" }),
		).toBeUndefined();
	});
});

describe("compareVersions / isVersionKilled", () => {
	it("compares dotted versions numerically", () => {
		expect(compareVersions("4.1.0", "4.1.0")).toBe(0);
		expect(compareVersions("4.1.10", "4.1.9")).toBeGreaterThan(0);
		expect(compareVersions("4.0.9", "4.1.0")).toBeLessThan(0);
		expect(compareVersions("4.1", "4.1.0")).toBe(0);
	});

	it("ignores pre-release suffixes", () => {
		expect(compareVersions("4.1.0-rc1", "4.1.0")).toBe(0);
	});

	it("kills at or below the scope, never above", () => {
		expect(isVersionKilled("4.1.0", "4.1.0")).toBe(true);
		expect(isVersionKilled("4.0.5", "4.1.0")).toBe(true);
		expect(isVersionKilled("4.1.1", "4.1.0")).toBe(false);
		expect(isVersionKilled("4.1.1", "*")).toBe(true);
		expect(isVersionKilled("4.1.1", undefined)).toBe(false);
	});
});

describe("normalizeKilledUpTo", () => {
	it("maps the legacy boolean format to kill-all", () => {
		expect(normalizeKilledUpTo(true)).toBe("*");
		expect(normalizeKilledUpTo(false)).toBeUndefined();
	});

	it("passes version strings through and rejects junk", () => {
		expect(normalizeKilledUpTo("4.1.0")).toBe("4.1.0");
		expect(normalizeKilledUpTo("")).toBeUndefined();
		expect(normalizeKilledUpTo(7)).toBeUndefined();
		expect(normalizeKilledUpTo(undefined)).toBeUndefined();
	});
});

describe("parseRolloutFlags", () => {
	it("promotes only on a literal boolean true", () => {
		expect(
			parseRolloutFlags({ featureFlags: { [ROLLOUT_FLAG]: true } })?.rollout,
		).toBe(true);
		// A mis-configured multivariate/numeric flag must fail SAFE (no promotion).
		for (const value of ["test", "control", 1, 0.5, {}, false, undefined]) {
			expect(
				parseRolloutFlags({ featureFlags: { [ROLLOUT_FLAG]: value } })?.rollout,
			).toBe(false);
		}
	});

	it("returns undefined for malformed responses", () => {
		expect(parseRolloutFlags(undefined)).toBeUndefined();
		expect(parseRolloutFlags({})).toBeUndefined();
		expect(parseRolloutFlags({ featureFlags: null })).toBeUndefined();
	});

	it("reads the kill-switch scope from the JSON payload", () => {
		const flags = parseRolloutFlags({
			featureFlags: { [KILLSWITCH_FLAG]: true },
			featureFlagPayloads: {
				[KILLSWITCH_FLAG]: JSON.stringify({ maxKilledVersion: "4.1.2" }),
			},
		});
		expect(flags?.killedUpToVersion).toBe("4.1.2");
	});

	it("accepts an already-decoded payload object", () => {
		const flags = parseRolloutFlags({
			featureFlags: { [KILLSWITCH_FLAG]: true },
			featureFlagPayloads: { [KILLSWITCH_FLAG]: { maxKilledVersion: "4.1.2" } },
		});
		expect(flags?.killedUpToVersion).toBe("4.1.2");
	});

	it("armed kill-switch with missing or invalid payload kills all versions", () => {
		expect(
			parseRolloutFlags({ featureFlags: { [KILLSWITCH_FLAG]: true } })
				?.killedUpToVersion,
		).toBe("*");
		expect(
			parseRolloutFlags({
				featureFlags: { [KILLSWITCH_FLAG]: true },
				featureFlagPayloads: { [KILLSWITCH_FLAG]: "not json {" },
			})?.killedUpToVersion,
		).toBe("*");
	});

	it("disarmed kill-switch yields no scope", () => {
		expect(
			parseRolloutFlags({ featureFlags: { [KILLSWITCH_FLAG]: false } })
				?.killedUpToVersion,
		).toBeUndefined();
	});
});

describe("nextCachedBundle", () => {
	const noKill = { rollout: false, killedUpToVersion: undefined };

	it("promotes into the cohort when the rollout flag is on", () => {
		expect(
			nextCachedBundle(undefined, { ...noKill, rollout: true }, "4.1.0"),
		).toBe("next");
	});

	it("stays legacy when the rollout flag is off", () => {
		expect(nextCachedBundle(undefined, noKill, "4.1.0")).toBe("legacy");
		expect(nextCachedBundle("legacy", noKill, "4.1.0")).toBe("legacy");
	});

	it("is one-way: dialing the percentage down never demotes an assigned machine", () => {
		expect(nextCachedBundle("next", noKill, "4.1.0")).toBe("next");
	});

	it("kill-switch demotes versions inside its scope", () => {
		const killed = { rollout: true, killedUpToVersion: "4.1.0" };
		expect(nextCachedBundle("next", killed, "4.1.0")).toBe("legacy");
		expect(nextCachedBundle("legacy", killed, "4.0.9")).toBe("legacy");
	});

	it("a fixed release above the kill scope re-promotes as usual", () => {
		const killed = { rollout: true, killedUpToVersion: "4.1.0" };
		expect(nextCachedBundle("legacy", killed, "4.1.1")).toBe("next");
		expect(nextCachedBundle("next", killed, "4.1.1")).toBe("next");
	});
});

describe("identity prefix", () => {
	it("maps the nightly manifest name to the cline-nightly namespace", () => {
		expect(idPrefix("cline-nightly")).toBe("cline-nightly");
	});

	it("maps everything else (stable claude-dev, unknown, missing) to cline", () => {
		expect(idPrefix("claude-dev")).toBe("cline");
		expect(idPrefix("some-fork")).toBe("cline");
		expect(idPrefix(undefined)).toBe("cline");
	});

	it("derives the setting section and context key from the prefix", () => {
		expect(settingSection("cline")).toBe("cline.rollout");
		expect(settingSection("cline-nightly")).toBe("cline-nightly.rollout");
		expect(bundleContextKey("cline")).toBe("cline.sdkBundle");
		expect(bundleContextKey("cline-nightly")).toBe("cline-nightly.sdkBundle");
	});
});
