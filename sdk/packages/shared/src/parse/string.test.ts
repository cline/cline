import { describe, expect, it } from "vitest";
import { trimNonEmpty } from "./string";

describe("trimNonEmpty", () => {
	it("returns trimmed strings and omits empty values", () => {
		expect(trimNonEmpty("  session-id  ")).toBe("session-id");
		expect(trimNonEmpty("   ")).toBeUndefined();
		expect(trimNonEmpty("")).toBeUndefined();
		expect(trimNonEmpty(undefined)).toBeUndefined();
		expect(trimNonEmpty(null)).toBeUndefined();
	});
});
