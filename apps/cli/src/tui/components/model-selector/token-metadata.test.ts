import { describe, expect, it } from "vitest";
import { hasDisplayableTokenCount } from "./token-metadata";

describe("hasDisplayableTokenCount", () => {
	it("accepts positive finite token counts", () => {
		expect(hasDisplayableTokenCount(32_000)).toBe(true);
	});

	it.each([
		0,
		-1,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		undefined,
	])("rejects non-displayable metadata %s", (value) => {
		expect(hasDisplayableTokenCount(value)).toBe(false);
	});
});
