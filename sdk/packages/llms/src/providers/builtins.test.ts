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

describe("cline-pass builtin spec", () => {
	it("registers a distinct Cline-compatible provider with a custom model list", async () => {
		const models = await getModelsForProvider("cline-pass");
		const provider = await getProvider("cline-pass");

		expect(provider).toMatchObject({
			id: "cline-pass",
			name: "ClinePass",
			baseUrl: `${CLINE_ENVIRONMENTS.production.apiBaseUrl}/api/v1`,
			client: "openai-compatible",
			capabilities: expect.arrayContaining([
				"oauth",
				"tools",
				"reasoning",
				"prompt-cache",
			]),
		});
		expect(models).toHaveProperty(provider?.defaultModelId ?? "");
		expect(Object.keys(models).length).toBeGreaterThan(0);
		for (const model of Object.values(models)) {
			expect(model.contextWindow).toBeGreaterThan(0);
			expect(model.maxInputTokens).toBeGreaterThan(0);
			expect(model.maxTokens).toBeGreaterThan(0);
			expect(model.capabilities).toEqual(expect.arrayContaining(["tools"]));
			expect(model.pricing).toBeDefined();
		}
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

	it("uses the current Hugging Face router endpoint", async () => {
		await expect(getProvider("huggingface")).resolves.toMatchObject({
			baseUrl: "https://router.huggingface.co/v1",
		});
	});

	it("derives ChatGPT subscription models from the generated OpenAI catalog", async () => {
		const chatGptModels = await getModelsForProvider("openai-codex");
		const openAiModels = await getModelsForProvider("openai-native");
		const modelIds = Object.keys(chatGptModels);

		expect(modelIds).toEqual(
			expect.arrayContaining([
				"gpt-5.5",
				"gpt-5.5-pro",
				"gpt-5.4",
				"gpt-5.4-mini",
			]),
		);
		expect(modelIds).not.toContain("gpt-5.1-codex-max");
		expect(modelIds).not.toContain("gpt-5.2");
		expect(modelIds).not.toContain("gpt-5.2-codex");
		expect(modelIds).not.toContain("gpt-5.3-codex");
		expect(modelIds).not.toContain("gpt-5.3-codex-spark");
		expect(modelIds).not.toContain("gpt-5.4-nano");
		expect(modelIds).not.toContain("o3");
		expect(chatGptModels["gpt-5.5"]).toEqual(
			expect.objectContaining({
				...openAiModels["gpt-5.5"],
				maxInputTokens: 272_000,
				contextWindow: 400_000,
			}),
		);
		expect(chatGptModels["gpt-5.4"]).toEqual(
			expect.objectContaining({
				name: "GPT-5.4",
				maxInputTokens: expect.any(Number),
				contextWindow: expect.any(Number),
			}),
		);
	});

	it("includes Claude Fable 5 in Anthropic, OpenRouter, Vercel AI Gateway, and Cline model lists", async () => {
		const anthropicModels = await getModelsForProvider("anthropic");
		const openRouterModels = await getModelsForProvider("openrouter");
		const vercelModels = await getModelsForProvider("vercel-ai-gateway");
		const clineModels = await getModelsForProvider("cline");

		expect(anthropicModels["claude-fable-5"]).toEqual(
			expect.objectContaining({
				name: "Claude Fable 5",
				contextWindow: 1_000_000,
				maxTokens: 128_000,
				capabilities: expect.arrayContaining([
					"tools",
					"reasoning",
					"prompt-cache",
				]),
				pricing: expect.objectContaining({
					input: 10,
					output: 50,
					cacheRead: 1,
					cacheWrite: 12.5,
				}),
			}),
		);
		expect(openRouterModels["anthropic/claude-fable-5"]).toEqual(
			expect.objectContaining({
				id: "anthropic/claude-fable-5",
				name: "Claude Fable 5",
				contextWindow: 1_000_000,
				maxTokens: 128_000,
			}),
		);
		expect(vercelModels["anthropic/claude-fable-5"]).toEqual(
			expect.objectContaining({
				id: "anthropic/claude-fable-5",
				name: "Claude Fable 5",
				contextWindow: 1_000_000,
			}),
		);
		expect(clineModels["anthropic/claude-fable-5"]).toEqual(
			openRouterModels["anthropic/claude-fable-5"],
		);
		expect(clineModels["anthropic/claude-opus-4.8"]).toBeDefined();
	});

	it("routes native Z.AI providers through GLM thinking metadata", async () => {
		for (const providerId of ["zai", "zai-coding-plan"] as const) {
			await expect(getProvider(providerId)).resolves.toMatchObject({
				metadata: {
					routing: {
						reasoning: {
							format: "glm-thinking",
						},
					},
				},
			});

			const models = Object.values(await getModelsForProvider(providerId));
			expect(models.length).toBeGreaterThan(0);
			for (const model of models) {
				expect(model.family?.startsWith("glm")).toBe(true);
			}
		}
	});

	it("routes direct MiniMax M3 through MiniMax thinking metadata", async () => {
		await expect(getProvider("minimax")).resolves.toMatchObject({
			metadata: {
				routing: {
					reasoning: {
						format: "minimax-thinking",
						routes: [
							expect.objectContaining({
								matcher: "model-id",
								modelId: "MiniMax-M3",
							}),
						],
					},
				},
			},
		});
	});
});
