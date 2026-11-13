import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The helper reads provider config only through ProviderSettingsManager; mock
// it so the test controls baseUrl/apiKey without touching disk.
let mockConfig: Record<string, unknown> | undefined;
vi.mock("@cline/core", () => ({
	ProviderSettingsManager: class {
		getProviderConfig() {
			return mockConfig;
		}
	},
}));

import { fetchOpenAiCompatibleModelIds } from "./openai-compatible-models";

describe("fetchOpenAiCompatibleModelIds", () => {
	const origEnv = process.env.OPENAI_API_KEY;
	let lastHeaders: Record<string, string> | undefined;

	beforeEach(() => {
		lastHeaders = undefined;
		mockConfig = undefined;
		delete process.env.OPENAI_API_KEY;
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async (_url: string, init?: { headers?: Record<string, string> }) => {
					lastHeaders = init?.headers;
					return {
						ok: true,
						json: async () => ({
							data: [{ id: "model-a" }, { id: "model-b" }],
						}),
					} as unknown as Response;
				},
			),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		if (origEnv === undefined) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = origEnv;
	});

	it("authenticates the model list with OPENAI_API_KEY when the key is only in the env", async () => {
		mockConfig = { baseUrl: "https://api.example.com/v1", headers: {} };
		process.env.OPENAI_API_KEY = "sk-env-key";

		const ids = await fetchOpenAiCompatibleModelIds("openai-compatible");

		expect(ids).toEqual(["model-a", "model-b"]);
		expect(lastHeaders?.Authorization).toBe("Bearer sk-env-key");
	});

	it("does not send OPENAI_API_KEY for a non-openai-compatible provider", async () => {
		mockConfig = { baseUrl: "https://api.example.com/v1", headers: {} };
		process.env.OPENAI_API_KEY = "sk-env-key";

		await fetchOpenAiCompatibleModelIds("some-other-provider");

		expect(lastHeaders?.Authorization).toBeUndefined();
	});

	it("prefers the stored apiKey over the env var", async () => {
		mockConfig = {
			baseUrl: "https://api.example.com/v1",
			apiKey: "sk-stored",
			headers: {},
		};
		process.env.OPENAI_API_KEY = "sk-env-key";

		await fetchOpenAiCompatibleModelIds("openai-compatible");

		expect(lastHeaders?.Authorization).toBe("Bearer sk-stored");
	});
});
