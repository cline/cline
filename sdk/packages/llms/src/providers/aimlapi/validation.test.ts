import { describe, expect, it } from "vitest";
import { isValidAimlapiEmail, parseAimlapiAmountUsd } from "./validation";

describe("aimlapi validation", () => {
	it("enforces partner checkout amount bounds", () => {
		expect(parseAimlapiAmountUsd(undefined)).toBe(2_500);
		expect(parseAimlapiAmountUsd("20")).toBe(2_000);
		expect(parseAimlapiAmountUsd("25.25")).toBe(2_525);
		expect(() => parseAimlapiAmountUsd("19.99")).toThrow(
			"Minimum top-up is $20",
		);
		expect(() => parseAimlapiAmountUsd("10000.01")).toThrow(
			"Maximum top-up is $10000",
		);
	});

	it("rejects incomplete email domains", () => {
		expect(isValidAimlapiEmail("user@example.com")).toBe(true);
		expect(isValidAimlapiEmail("user@example")).toBe(false);
		expect(isValidAimlapiEmail("user@example.c")).toBe(false);
		expect(isValidAimlapiEmail("user@.example.com")).toBe(false);
	});
});
