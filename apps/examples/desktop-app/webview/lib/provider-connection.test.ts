import { describe, expect, it } from "vitest";
import { isProviderConnected } from "./provider-connection";
import type { Provider } from "./provider-schema";

function makeProvider(overrides: Partial<Provider>): Provider {
	return {
		id: "test",
		name: "Test",
		models: 0,
		color: "#000",
		letter: "T",
		enabled: false,
		...overrides,
	};
}

describe("isProviderConnected", () => {
	it("counts a provider with an API key", () => {
		expect(isProviderConnected(makeProvider({ apiKey: "sk-123" }))).toBe(true);
	});

	it("counts a provider with an OAuth access token", () => {
		expect(
			isProviderConnected(makeProvider({ oauthAccessTokenPresent: true })),
		).toBe(true);
	});

	it("ignores whitespace-only API keys on disabled providers", () => {
		expect(isProviderConnected(makeProvider({ apiKey: "   " }))).toBe(false);
	});

	it("never counts a disabled provider without credentials", () => {
		expect(
			isProviderConnected(makeProvider({ enabled: false, configured: true })),
		).toBe(false);
	});

	it("counts an enabled provider the sidecar reports as configured", () => {
		expect(
			isProviderConnected(
				makeProvider({ id: "ollama", enabled: true, configured: true }),
			),
		).toBe(true);
	});

	it("rejects an enabled provider without sidecar-verified credentials", () => {
		// Legacy VS Code migration can seed enabled entries (e.g. qwen-code,
		// sapaicore) holding only a default model and no credentials. Enabled
		// alone must not read as configured.
		expect(
			isProviderConnected(
				makeProvider({ id: "qwen-code", enabled: true, configured: false }),
			),
		).toBe(false);
		expect(
			isProviderConnected(makeProvider({ id: "sapaicore", enabled: true })),
		).toBe(false);
	});
});
