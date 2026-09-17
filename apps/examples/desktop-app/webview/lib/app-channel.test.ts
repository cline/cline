import { describe, expect, it } from "vitest";

import {
	BETA_PRODUCT_NAME,
	isBetaVersion,
	productNameForVersion,
	STABLE_PRODUCT_NAME,
} from "./app-channel";

describe("app channel", () => {
	it("detects beta builds from the prerelease version suffix", () => {
		expect(isBetaVersion("0.0.14-beta.1")).toBe(true);
		expect(isBetaVersion("1.2.3-beta.12")).toBe(true);
		expect(isBetaVersion("0.0.13")).toBe(false);
		expect(isBetaVersion("")).toBe(false);
		expect(isBetaVersion(null)).toBe(false);
		expect(isBetaVersion(undefined)).toBe(false);
	});

	it("maps the version to the shipped product name", () => {
		expect(productNameForVersion("0.0.14-beta.1")).toBe(BETA_PRODUCT_NAME);
		expect(productNameForVersion("0.0.13")).toBe(STABLE_PRODUCT_NAME);
		expect(productNameForVersion(null)).toBe(STABLE_PRODUCT_NAME);
	});
});
