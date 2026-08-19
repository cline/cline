import { describe, expect, it } from "vitest";
import { resolveVercelAiGatewayBaseUrl, trimTrailingSlashes } from "./url";

describe("provider URL helpers", () => {
	it("trims arbitrarily long trailing slash runs in linear time", () => {
		expect(
			trimTrailingSlashes(`https://example.test${"/".repeat(10_000)}`),
		).toBe("https://example.test");
	});

	it.each([
		["https://example.test/v1", "https://example.test/v4/ai"],
		["https://example.test/v12/ai", "https://example.test/v4/ai"],
		["https://example.test/v4/ai", "https://example.test/v4/ai"],
		["https://example.test/api", "https://example.test/api/v4/ai"],
	])("normalizes %s", (input, expected) => {
		expect(resolveVercelAiGatewayBaseUrl(input, "unused")).toBe(expected);
	});
});
