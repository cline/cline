import { describe, expect, it } from "vitest";
import { isClinePassLimitMessage } from "../index.browser";
import {
	extractClineFreeModelLimitResetTime,
	extractClinePassLimitMessage,
	isClineFreeModelLimitMessage,
} from "./errors";

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

	it("handles tab-heavy non-matches without regex backtracking", () => {
		expect(
			isClinePassLimitMessage(`You have reached your\t${"\t".repeat(10_000)}`),
		).toBe(false);
		expect(
			isClinePassLimitMessage(`You have reached your\t-${"\t".repeat(10_000)}`),
		).toBe(false);
		expect(
			isClinePassLimitMessage(
				`You have reached your\t-\tClinepass limit.The limit resets in\t${"\t".repeat(10_000)}`,
			),
		).toBe(false);
	});
});

describe("extractClinePassLimitMessage", () => {
	it("extracts the ClinePass weekly limit message", () => {
		const message =
			"You have reached your weekly Clinepass limit. The limit resets in 7d, please try again later.";

		const extracted = extractClinePassLimitMessage(`Error: ${message}`);
		expect(extracted).toBe(message);
	});

	it("extracts the 5-hour ClinePass limit message", () => {
		const message =
			"You have reached your 5-hour Clinepass limit. The limit resets in 5h, please try again later.";

		const extracted = extractClinePassLimitMessage(`Error: ${message}`);
		expect(extracted).toBe(message);
	});
});

describe("Cline free model limit messages", () => {
	const message =
		"Daily free limit reached on model deepseek/deepseek-v4-flash. Try again in 23h 59m";

	it("detects the message in an HTTP error", () => {
		const error = `Error: Error 429: ${message}`;
		expect(isClineFreeModelLimitMessage(error)).toBe(true);
		expect(extractClineFreeModelLimitResetTime(error)).toBe("23h 59m");
	});

	it("does not match unrelated daily limits", () => {
		expect(
			isClineFreeModelLimitMessage(
				"Your daily spend limit has been reached. Try again in 23h 59m",
			),
		).toBe(false);
	});
});
