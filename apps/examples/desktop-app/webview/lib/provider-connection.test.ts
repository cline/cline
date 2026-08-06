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
			isProviderConnected(
				makeProvider({
					enabled: false,
					configFields: [{ path: "baseUrl", label: "Base URL", type: "url" }],
					configValues: { baseUrl: "http://localhost:11434" },
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
						{
							path: "gcp.projectId",
							label: "Project",
							type: "text",
							required: true,
						},
						{ path: "gcp.region", label: "Region", type: "text" },
					],
					configValues: {
						"gcp.projectId": "my-project",
						"gcp.region": "us-central1",
					},
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
						{
							path: "gcp.projectId",
							label: "Project",
							type: "text",
							required: true,
						},
					],
					configValues: { "gcp.projectId": "" },
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

	it("counts an enabled provider whose auth lives outside the catalog (Bedrock IAM)", () => {
		// Bedrock's catalog entry has an *optional* apiKey field ("Optional
		// Bedrock bearer token") and no required fields — IAM/profile users
		// authenticate entirely outside the catalog and must not be nagged.
		expect(
			isProviderConnected(
				makeProvider({
					id: "bedrock",
					enabled: true,
					configFields: [
						{
							path: "aws.authentication",
							label: "Authentication",
							type: "select",
							defaultValue: "iam",
						},
						{ path: "aws.region", label: "AWS Region", type: "text" },
						{
							path: "apiKey",
							label: "Bedrock API Key",
							type: "password",
							secret: true,
						},
					],
					configValues: { "aws.authentication": "iam", apiKey: "" },
				}),
			),
		).toBe(true);
	});
});
