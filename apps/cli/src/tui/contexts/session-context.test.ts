import { describe, expect, it } from "vitest";
import { nextUsageTokenDisplay } from "./session-context";

describe("nextUsageTokenDisplay", () => {
	it("uses streaming input tokens as an absolute context size", () => {
		let displayedTokens = 0;

		displayedTokens = nextUsageTokenDisplay(displayedTokens, {
			inputTokens: 633_000,
			outputTokens: 31_000,
		});
		displayedTokens = nextUsageTokenDisplay(displayedTokens, {
			inputTokens: 934_000,
			outputTokens: 266_000,
		});

		expect(displayedTokens).toBe(934_000);
	});

	it("ignores output-only usage events for the context size display", () => {
		expect(
			nextUsageTokenDisplay(633_000, {
				outputTokens: 31_000,
			}),
		).toBe(633_000);
	});
});
