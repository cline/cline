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
		expect(
			isProviderConnected(makeProvider({ apiKey: "sk-123" })),
		).toBe(true);
	});

	it("counts a provider with an OAuth access token", () => {
		expect(
			isProviderConnected(makeProvider({ oauthAccessTokenPresent: true })),
		).toBe(true);
	});

	it("ignores whitespace-only API keys", () => {
		expect(isProviderConnected(makeProvider({ apiKey: "   " }))).toBe(false);
	});

	it("requires the provider to be enabled for config-based connections", () => {
		expect(
			isProviderConnected(
				makeProvider({
					enabled: false,
					configFields: [
						{ path: "gcp.projectId", label: "Project", type: "text", required: true },
					],
					configValues: { "gcp.projectId": "my-project" },
				}),
			),
		).toBe(false);
	});

	it("counts an enabled structured-config provider with all required fields filled", () => {
		expect(
			isProviderConnected(
				makeProvider({
					enabled: true,
					configFields: [
						{ path: "gcp.projectId", label: "Project", type: "text", required: true },
						{ path: "gcp.region", label: "Region", type: "text", required: true },
					],
					configValues: { "gcp.projectId": "my-project", "gcp.region": "us-central1" },
				}),
			),
		).toBe(true);
	});

	it("rejects an enabled structured-config provider missing a required field", () => {
		expect(
			isProviderConnected(
				makeProvider({
					enabled: true,
					configFields: [
						{ path: "gcp.projectId", label: "Project", type: "text", required: true },
						{ path: "gcp.region", label: "Region", type: "text", required: true },
					],
					configValues: { "gcp.projectId": "my-project", "gcp.region": "" },
				}),
			),
		).toBe(false);
	});

	it("counts an enabled keyless provider (local endpoint)", () => {
		expect(
			isProviderConnected(
				makeProvider({
					id: "ollama",
					enabled: true,
					configFields: [{ path: "baseUrl", label: "Base URL", type: "url" }],
					configValues: { baseUrl: "http://localhost:11434" },
				}),
			),
		).toBe(true);
	});

	it("rejects an enabled key provider whose optional API key is empty", () => {
		expect(
			isProviderConnected(
				makeProvider({
					enabled: true,
					configFields: [
						{ path: "apiKey", label: "API Key", type: "password", secret: true },
					],
					configValues: { apiKey: "" },
				}),
			),
		).toBe(false);
	});
});
