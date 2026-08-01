import { describe, expect, it } from "vitest";
import {
	type ClineRecommendedModelsData,
	FALLBACK_CLINE_RECOMMENDED_MODELS,
	fetchClineRecommendedModels,
} from "./cline-recommended-models";
import type { ModelInfo } from "./provider-settings";

const BASE_URL = "https://api.example.test";

function jsonResponse(payload: unknown): typeof fetch {
	return async () =>
		new Response(JSON.stringify(payload), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
}

function model(id: string, name: string): ModelInfo {
	return { id, name };
}

// The endpoint only sends slug-like names, mirroring production behavior.
const ENDPOINT_PAYLOAD = {
	recommended: [
		{
			id: "anthropic/claude-opus-5",
			name: "claude-opus-5",
			description: "",
			tags: ["NEW"],
		},
		{ id: "vendor/named-model", name: "named-model", description: "" },
		{ id: "vendor/unnamed-model", description: "" },
		// Vercel-style id; the catalog keys this model under "z-ai/glm-5.2"
		{ id: "zai/glm-5.2", name: "glm-5.2", description: "" },
	],
	free: [
		{
			id: "deepseek/deepseek-v4-flash",
			name: "deepseek-v4-flash",
			description: "",
		},
		{ id: "cline-free/glm-5.2", name: "cline-free/glm-5.2", description: "" },
		{
			id: "poolside/laguna-s-2.1:free",
			name: "laguna-s-2.1:free",
			description: "",
		},
	],
	clinePass: [
		{ id: "cline-pass/glm-5.2", name: "cline-pass/glm-5.2", description: "" },
		{ id: "cline-pass/mystery", name: "cline-pass/mystery", description: "" },
	],
};

const CATALOG = {
	openrouter: {
		"anthropic/claude-opus-5": model(
			"anthropic/claude-opus-5",
			"Claude Opus 5",
		),
		"z-ai/glm-5.2": model("z-ai/glm-5.2", "GLM-5.2"),
	},
	cline: {
		"deepseek/deepseek-v4-flash": model(
			"deepseek/deepseek-v4-flash",
			"DeepSeek V4 Flash",
		),
		"cline-free/glm-5.2": model("cline-free/glm-5.2", "GLM-5.2 (free)"),
		"poolside/laguna-s-2.1:free": model(
			"poolside/laguna-s-2.1:free",
			"Laguna S 2.1 (free)",
		),
	},
	"cline-pass": {
		"cline-pass/glm-5.2": model("cline-pass/glm-5.2", "GLM-5.2"),
	},
};

function namesOf(data: ClineRecommendedModelsData) {
	return {
		recommended: data.recommended.map((m) => m.name),
		free: data.free.map((m) => m.name),
		clinePass: data.clinePass.map((m) => m.name),
	};
}

describe("fetchClineRecommendedModels", () => {
	it("resolves display names from the models catalog", async () => {
		const data = await fetchClineRecommendedModels({
			baseUrl: BASE_URL,
			fetchImpl: jsonResponse(ENDPOINT_PAYLOAD),
			catalogLoader: async () => CATALOG,
		});

		expect(namesOf(data)).toEqual({
			// Catalog name first (including via id aliases like zai/ -> z-ai/);
			// endpoint name when the catalog misses; the id slug when the
			// endpoint name is just the id.
			recommended: ["Claude Opus 5", "named-model", "unnamed-model", "GLM-5.2"],
			// Free markers are redundant next to the pickers' FREE chips.
			free: ["DeepSeek V4 Flash", "GLM-5.2", "Laguna S 2.1"],
			clinePass: ["GLM-5.2", "mystery"],
		});
		// Ids are preserved untouched.
		expect(data.free.map((m) => m.id)).toEqual([
			"deepseek/deepseek-v4-flash",
			"cline-free/glm-5.2",
			"poolside/laguna-s-2.1:free",
		]);
	});

	it("degrades to endpoint names and id slugs when the catalog is unavailable", async () => {
		const data = await fetchClineRecommendedModels({
			baseUrl: BASE_URL,
			fetchImpl: jsonResponse(ENDPOINT_PAYLOAD),
			catalogLoader: async () => {
				throw new Error("models.dev unreachable");
			},
		});

		expect(namesOf(data)).toEqual({
			recommended: ["claude-opus-5", "named-model", "unnamed-model", "glm-5.2"],
			free: ["deepseek-v4-flash", "glm-5.2", "laguna-s-2.1"],
			clinePass: ["glm-5.2", "mystery"],
		});
	});

	it("does not wait for a hung catalog loader beyond the timeout", async () => {
		const data = await fetchClineRecommendedModels({
			baseUrl: BASE_URL,
			fetchImpl: jsonResponse(ENDPOINT_PAYLOAD),
			timeoutMs: 25,
			catalogLoader: () => new Promise(() => {}),
		});

		expect(data.recommended[0]?.name).toBe("claude-opus-5");
	});

	it("shares one timeout budget between the feed request and the catalog lookup", async () => {
		// A feed response that consumes most of the window must not grant the
		// hung catalog loader a fresh full window on top (which would roughly
		// double the worst-case loading time).
		const feedDelayMs = 400;
		const timeoutMs = 500;
		const slowFeed: typeof fetch = async () => {
			await new Promise((resolve) => setTimeout(resolve, feedDelayMs));
			return new Response(JSON.stringify(ENDPOINT_PAYLOAD), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		const startedAt = Date.now();
		const data = await fetchClineRecommendedModels({
			baseUrl: BASE_URL,
			fetchImpl: slowFeed,
			timeoutMs,
			catalogLoader: () => new Promise(() => {}),
		});
		const elapsedMs = Date.now() - startedAt;

		// Stacked windows would take ~feedDelayMs + timeoutMs (~900ms).
		expect(elapsedMs).toBeLessThan(feedDelayMs + timeoutMs - 100);
		expect(data.recommended[0]?.name).toBe("claude-opus-5");
	});

	it("still applies an instantly-resolving catalog when the budget is exhausted", async () => {
		// Simulates a cached catalog: getLiveModelsCatalog resolves cached data
		// on a microtask, which beats the zero-delay degradation timer even
		// when the feed request consumed the whole window.
		const timeoutMs = 50;
		const slowFeed: typeof fetch = async () => {
			await new Promise((resolve) => setTimeout(resolve, timeoutMs));
			return new Response(JSON.stringify(ENDPOINT_PAYLOAD), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		const data = await fetchClineRecommendedModels({
			baseUrl: BASE_URL,
			fetchImpl: slowFeed,
			timeoutMs,
			catalogLoader: async () => CATALOG,
		});

		expect(data.recommended[0]?.name).toBe("Claude Opus 5");
	});

	it("returns the bundled fallback untouched when the endpoint fails", async () => {
		const data = await fetchClineRecommendedModels({
			baseUrl: BASE_URL,
			fetchImpl: async () => new Response("nope", { status: 500 }),
			catalogLoader: async () => CATALOG,
		});

		// Exact equality lets callers detect a transient failure (the VS Code
		// controller compares against the fallback to skip caching it).
		expect(data).toEqual(FALLBACK_CLINE_RECOMMENDED_MODELS);
	});
});
