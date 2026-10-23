import { describe, expect, it } from "vitest";
import { shouldUseStagingEphemeralAuth } from "./runtime";

describe("shouldUseStagingEphemeralAuth", () => {
	it("requires an explicit staging-only development flag", () => {
		expect(shouldUseStagingEphemeralAuth("staging", "1")).toBe(true);
		expect(shouldUseStagingEphemeralAuth("staging", undefined)).toBe(false);
		expect(shouldUseStagingEphemeralAuth("staging", "0")).toBe(false);
	});

	it("never downgrades production credential storage", () => {
		expect(shouldUseStagingEphemeralAuth("production", "1")).toBe(false);
	});
});
