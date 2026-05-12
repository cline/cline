import { CLINE_ENVIRONMENT_ENV, CLINE_ENVIRONMENTS } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_SPECS } from "./builtins";
import { getModelsForProvider, getProvider } from "./model-registry";

function findClineSpec() {
	const spec = BUILTIN_SPECS.find((s) => s.id === "cline");
	if (!spec) {
		throw new Error("cline builtin spec not found");
	}
	return spec;
}

describe("cline builtin spec defaults.baseUrl", () => {
	const originalEnvironment = process.env[CLINE_ENVIRONMENT_ENV];

	beforeEach(() => {
		delete process.env[CLINE_ENVIRONMENT_ENV];
	});

	afterEach(() => {
		if (originalEnvironment === undefined) {
			delete process.env[CLINE_ENVIRONMENT_ENV];
		} else {
			process.env[CLINE_ENVIRONMENT_ENV] = originalEnvironment;
		}
	});

	it("re-resolves baseUrl when CLINE_ENVIRONMENT changes between reads", () => {
		const spec = findClineSpec();

		expect(spec.defaults?.baseUrl).toBe(
			`${CLINE_ENVIRONMENTS.production.apiBaseUrl}/api/v1`,
		);

		process.env[CLINE_ENVIRONMENT_ENV] = "staging";
		expect(spec.defaults?.baseUrl).toBe(
			`${CLINE_ENVIRONMENTS.staging.apiBaseUrl}/api/v1`,
		);

		process.env[CLINE_ENVIRONMENT_ENV] = "local";
		expect(spec.defaults?.baseUrl).toBe(
			`${CLINE_ENVIRONMENTS.local.apiBaseUrl}/api/v1`,
		);

		delete process.env[CLINE_ENVIRONMENT_ENV];
		expect(spec.defaults?.baseUrl).toBe(
			`${CLINE_ENVIRONMENTS.production.apiBaseUrl}/api/v1`,
		);
	});
});

describe("built-in provider metadata", () => {
	it("marks popular providers with a provider capability and rank", async () => {
		await expect(getProvider("cline")).resolves.toMatchObject({
			capabilities: expect.arrayContaining(["popular"]),
			metadata: { popularRank: 1 },
		});
		await expect(getProvider("zai")).resolves.not.toMatchObject({
			capabilities: expect.arrayContaining(["popular"]),
		});
	});

	it("enriches OpenAI Codex fallback models from the generated OpenAI catalog", async () => {
		const models = await getModelsForProvider("openai-codex");

		expect(models["gpt-5.4"]).toEqual(
			expect.objectContaining({
				name: "GPT-5.4",
				maxInputTokens: expect.any(Number),
				contextWindow: expect.any(Number),
			}),
		);
		expect(models["gpt-5.3-codex"]).toEqual(
			expect.objectContaining({
				name: "GPT-5.3 Codex",
				maxInputTokens: expect.any(Number),
				contextWindow: expect.any(Number),
			}),
		);
	});
});
