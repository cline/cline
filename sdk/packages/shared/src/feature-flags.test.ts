import { describe, expect, it } from "vitest";
import { parseLangfuseTelemetryConfig } from "./feature-flags";

describe("parseLangfuseTelemetryConfig", () => {
	it("normalizes a complete feature-flag payload", () => {
		expect(
			parseLangfuseTelemetryConfig({
				baseUrl: " https://langfuse.example ",
				publicKey: " public-key ",
				secretKey: " secret-key ",
			}),
		).toEqual({
			baseUrl: "https://langfuse.example",
			publicKey: "public-key",
			secretKey: "secret-key",
		});
	});

	it.each([
		false,
		{},
		{ baseUrl: "https://langfuse.example", publicKey: "public-key" },
		{
			baseUrl: "not-a-url",
			publicKey: "public-key",
			secretKey: "secret-key",
		},
		{
			baseUrl: "file:///tmp/langfuse",
			publicKey: "public-key",
			secretKey: "secret-key",
		},
	])("rejects an invalid payload: %j", (payload) => {
		expect(parseLangfuseTelemetryConfig(payload)).toBeUndefined();
	});
});
