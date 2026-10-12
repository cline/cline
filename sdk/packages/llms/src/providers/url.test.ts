import { describe, expect, it } from "vitest";
import {
	isOfficialAnthropicEndpoint,
	resolveVercelAiGatewayBaseUrl,
	trimTrailingSlashes,
} from "./url";

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

describe("isOfficialAnthropicEndpoint", () => {
	it.each([
		undefined,
		"",
		"https://api.anthropic.com",
		"https://api.anthropic.com/v1",
		"https://api.anthropic.com/v1/",
	])("treats %s as the official Claude API", (baseUrl) => {
		expect(isOfficialAnthropicEndpoint(baseUrl)).toBe(true);
	});

	it.each([
		"https://example.services.ai.azure.com/anthropic",
		"https://example.services.ai.azure.com/anthropic/v1",
		"https://example.services.ai.azure.com/anthropic/v1/messages",
		"https://api.anthropic.com.example.com/v1",
		"http://api.anthropic.com/v1",
		"http://127.0.0.1:9000",
		"not a url",
	])("treats %s as a custom endpoint", (baseUrl) => {
		expect(isOfficialAnthropicEndpoint(baseUrl)).toBe(false);
	});
});
