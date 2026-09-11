import { describe, expect, it } from "bun:test";
import {
	bundleContextKey,
	decideBundle,
	decisionOverrideSource,
	idPrefix,
	parseRolloutAssignment,
	ROLLOUT_FLAG,
	settingSection,
} from "./cohort";

const base = {
	envOverride: undefined,
	settingOverride: undefined,
	cached: undefined,
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

	it("a previous activation failure on this version forces legacy", () => {
		expect(
			decideBundle({ ...base, cached: "next", previousFailure: true }),
		).toBe("legacy");
	});

	it("env override beats everything, including a previous failure", () => {
		expect(
			decideBundle({ ...base, envOverride: "next", previousFailure: true }),
		).toBe("next");
		expect(
			decideBundle({ ...base, envOverride: "legacy", cached: "next" }),
		).toBe("legacy");
	});

	it("user setting overrides in both directions", () => {
		expect(
			decideBundle({ ...base, settingOverride: "next", previousFailure: true }),
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

describe("parseRolloutAssignment", () => {
	it("promotes only on a literal boolean true", () => {
		expect(
			parseRolloutAssignment({ featureFlags: { [ROLLOUT_FLAG]: true } }),
		).toBe("next");
	});

	it("is two-way: anything else resolves to legacy (fail-safe)", () => {
		// false = dialed out of the cohort; the rest = mis-configured flag.
		for (const value of ["test", "control", 1, 0.5, {}, false, undefined]) {
			expect(
				parseRolloutAssignment({ featureFlags: { [ROLLOUT_FLAG]: value } }),
			).toBe("legacy");
		}
		// Flag deleted / not created yet: nobody promoted.
		expect(parseRolloutAssignment({ featureFlags: {} })).toBe("legacy");
	});

	it("returns undefined for malformed responses (cache left untouched)", () => {
		expect(parseRolloutAssignment(undefined)).toBeUndefined();
		expect(parseRolloutAssignment({})).toBeUndefined();
		expect(parseRolloutAssignment({ featureFlags: null })).toBeUndefined();
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
