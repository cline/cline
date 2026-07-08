import { describe, expect, it } from "vitest";
import { isClinePassLimitMessage } from "../index.browser";
import { extractClinePassLimitMessage } from "./errors";

describe("isClinePassLimitMessage", () => {
	it("matches the ClinePass weekly limit message", () => {
		const message =
			"You have reached your weekly Clinepass limit. The limit resets in 7d, please try again later.";
		expect(isClinePassLimitMessage(message)).toBe(true);
	});

	it("matches the 5-hour ClinePass limit message", () => {
		const message =
			"You have reached your 5-hour Clinepass limit. The limit resets in 5h, please try again later.";
		expect(isClinePassLimitMessage(message)).toBe(true);
	});
});

describe("extractClinePassLimitMessage", () => {
	it("extracts the ClinePass weekly limit message", () => {
		const message =
			"You have reached your weekly Clinepass limit. The limit resets in 7d, please try again later.";

		const extracted = extractClinePassLimitMessage(`Error: ${message}`);
		expect(extracted?.[0]).toBe(message);
	});

	it("extracts the 5-hour ClinePass limit message", () => {
		const message =
			"You have reached your 5-hour Clinepass limit. The limit resets in 5h, please try again later.";

		const extracted = extractClinePassLimitMessage(`Error: ${message}`);
		expect(extracted?.[0]).toBe(message);
	});
});
