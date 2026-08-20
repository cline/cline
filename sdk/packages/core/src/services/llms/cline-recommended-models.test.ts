import { describe, expect, it } from "vitest";
import {
	applyClineFeaturedModels,
	type ClineRecommendedModelsData,
	FALLBACK_CLINE_RECOMMENDED_MODELS,
	fetchClineRecommendedModels,
	getCachedClineRecommendedModels,
	peekClineRecommendedModels,
	resetClineRecommendedModelsCacheForTests,
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

describe("applyClineFeaturedModels", () => {
	const data: ClineRecommendedModelsData = {
		recommended: [
			{
				id: "anthropic/claude-opus-5",
				name: "Claude Opus 5",
				description: "Most intelligent model",
				tags: ["NEW"],
			},
			// Vercel-style spelling; the catalog keys it as "z-ai/glm-5.2".
			{ id: "zai/glm-5.2", name: "GLM 5.2", description: "", tags: [] },
		],
		free: [
			{
				id: "deepseek/deepseek-v4-flash",
				name: "DeepSeek V4 Flash",
				description: "Fast and efficient",
				tags: [],
			},
		],
		clinePass: [
			{
				id: "cline-pass/kimi-k3",
				name: "Kimi K3",
				description: "Leading open weights model",
				tags: [],
			},
		],
	};

	it("stamps recommended and free tiers onto the cline model list", () => {
		const models = applyClineFeaturedModels(
			"cline",
			[
				{ id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
				{ id: "z-ai/glm-5.2", name: "GLM 5.2" },
				{ id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
				{ id: "vendor/unrelated", name: "Unrelated" },
			],
			data,
		);

		expect(models[0]?.featured).toEqual({
			tier: "recommended",
			rank: 0,
			tags: ["NEW"],
		});
		expect(models[0]?.description).toBe("Most intelligent model");
		// Alias spellings resolve through the Vercel/OpenRouter rules.
		expect(models[1]?.featured).toEqual({
			tier: "recommended",
			rank: 1,
			tags: [],
		});
		expect(models[2]?.featured).toEqual({ tier: "free", rank: 0, tags: [] });
		expect(models[3]?.featured).toBeUndefined();
	});

	it("stamps subscribed and free tiers for cline-pass and skips other providers", () => {
		const models = applyClineFeaturedModels(
			"cline-pass",
			[
				{ id: "cline-pass/kimi-k3", name: "Kimi K3" },
				{ id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
			],
			data,
		);
		expect(models[0]?.featured?.tier).toBe("subscribed");
		expect(models[1]?.featured?.tier).toBe("free");

		const untouched = [{ id: "claude-sonnet-4-6", name: "Claude Sonnet" }];
		expect(applyClineFeaturedModels("anthropic", untouched, data)).toBe(
			untouched,
		);
	});

	it("matches vendor-prefix mismatches by unambiguous slug without duplicating tiers", () => {
		const fallbackVintage: ClineRecommendedModelsData = {
			recommended: [],
			free: [
				{
					id: "kwaipilot/kat-coder-pro",
					name: "KwaiKAT Kat Coder Pro",
					description: "Advanced agentic coding model",
					tags: ["FREE"],
				},
			],
			clinePass: [],
		};

		// Catalog knows the model only under the cline-free prefix: the slug
		// fallback stamps it even though no alias rule covers the prefix.
		const slugOnly = applyClineFeaturedModels(
			"cline",
			[{ id: "cline-free/kat-coder-pro", name: "Kat Coder Pro" }],
			fallbackVintage,
		);
		expect(slugOnly[0]?.featured?.tier).toBe("free");

		// Catalog carries BOTH spellings: the exact id wins and the slug match
		// must not stamp the second row, or the tier would render twice.
		const bothSpellings = applyClineFeaturedModels(
			"cline",
			[
				{ id: "kwaipilot/kat-coder-pro", name: "Kat Coder Pro" },
				{ id: "cline-free/kat-coder-pro", name: "Kat Coder Pro (free)" },
			],
			fallbackVintage,
		);
		expect(bothSpellings[0]?.featured?.tier).toBe("free");
		expect(bothSpellings[1]?.featured).toBeUndefined();

		// An ambiguous slug (two different feed entries) stamps nothing.
		const ambiguous = applyClineFeaturedModels(
			"cline",
			[{ id: "cline-free/shared-slug", name: "Shared" }],
			{
				recommended: [
					{ id: "vendor-a/shared-slug", name: "A", description: "", tags: [] },
					{ id: "vendor-b/shared-slug", name: "B", description: "", tags: [] },
				],
				free: [],
				clinePass: [],
			},
		);
		expect(ambiguous[0]?.featured).toBeUndefined();
	});

	it("keeps the model's own description when the feed entry has none", () => {
		const models = applyClineFeaturedModels(
			"cline",
			[
				{
					id: "z-ai/glm-5.2",
					name: "GLM 5.2",
					description: "Catalog description",
				},
			],
			data,
		);
		expect(models[0]?.description).toBe("Catalog description");
	});
});

describe("getCachedClineRecommendedModels", () => {
	it("serves one fetch to concurrent and subsequent callers", async () => {
		resetClineRecommendedModelsCacheForTests();
		let calls = 0;
		const fetchImpl: typeof fetch = async () => {
			calls += 1;
			return new Response(JSON.stringify(ENDPOINT_PAYLOAD), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};
		const options = {
			baseUrl: BASE_URL,
			fetchImpl,
			catalogLoader: async () => CATALOG,
		};

		const [first, second] = await Promise.all([
			getCachedClineRecommendedModels(options),
			getCachedClineRecommendedModels(options),
		]);
		const third = await getCachedClineRecommendedModels(options);

		expect(calls).toBe(1);
		expect(first.recommended.length).toBeGreaterThan(0);
		expect(second.recommended.length).toBe(first.recommended.length);
		expect(third.recommended.length).toBe(first.recommended.length);
		resetClineRecommendedModelsCacheForTests();
	});

	it("caches the bundled fallback so offline callers do not re-pay the timeout", async () => {
		resetClineRecommendedModelsCacheForTests();
		let calls = 0;
		const fetchImpl: typeof fetch = async () => {
			calls += 1;
			return new Response("nope", { status: 500 });
		};
		const options = {
			baseUrl: BASE_URL,
			fetchImpl,
			catalogLoader: async () => CATALOG,
		};

		const first = await getCachedClineRecommendedModels(options);
		const second = await getCachedClineRecommendedModels(options);

		expect(calls).toBe(1);
		expect(first).toEqual(FALLBACK_CLINE_RECOMMENDED_MODELS);
		expect(second).toEqual(FALLBACK_CLINE_RECOMMENDED_MODELS);
		resetClineRecommendedModelsCacheForTests();
	});

	it("does not let an in-flight request repopulate the cache after a reset", async () => {
		resetClineRecommendedModelsCacheForTests();
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const staleFetch: typeof fetch = async () => {
			await gate;
			return new Response(JSON.stringify(ENDPOINT_PAYLOAD), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};
		const stale = getCachedClineRecommendedModels({
			baseUrl: BASE_URL,
			fetchImpl: staleFetch,
			catalogLoader: async () => CATALOG,
		});

		// Reset while the first request is still in flight, then resolve it:
		// its result must not land in the cleared cache.
		resetClineRecommendedModelsCacheForTests();
		release?.();
		await stale;

		let calls = 0;
		const freshFetch: typeof fetch = async () => {
			calls += 1;
			return new Response(JSON.stringify(ENDPOINT_PAYLOAD), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};
		await getCachedClineRecommendedModels({
			baseUrl: BASE_URL,
			fetchImpl: freshFetch,
			catalogLoader: async () => CATALOG,
		});
		expect(calls).toBe(1);
		resetClineRecommendedModelsCacheForTests();
	});
});

describe("peekClineRecommendedModels", () => {
	it("returns the bundled fallback when the cache is cold", () => {
		resetClineRecommendedModelsCacheForTests();
		expect(peekClineRecommendedModels()).toEqual(
			FALLBACK_CLINE_RECOMMENDED_MODELS,
		);
	});

	it("returns the cached live feed once warmed, without another fetch", async () => {
		resetClineRecommendedModelsCacheForTests();
		let calls = 0;
		await getCachedClineRecommendedModels({
			baseUrl: BASE_URL,
			fetchImpl: async () => {
				calls += 1;
				return new Response(JSON.stringify(ENDPOINT_PAYLOAD), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
			catalogLoader: async () => CATALOG,
		});

		const peeked = peekClineRecommendedModels();

		expect(calls).toBe(1);
		expect(peeked.recommended.map((m) => m.id)).toEqual(
			ENDPOINT_PAYLOAD.recommended.map((m) => m.id),
		);
		resetClineRecommendedModelsCacheForTests();
	});
});
