import { afterEach, describe, expect, it, vi } from "vitest";
import { enrichOllamaModelCapabilities } from "./model-source";

const model = () => ({
	supportsVision: false,
	supportsAttachments: false,
	supportsReasoning: false,
});
afterEach(() => vi.unstubAllGlobals());
describe("Ollama capability discovery", () => {
	it("reads per-model vision and thinking, without marking text models as vision", async () => {
		const fetcher = vi.fn(
			async (_url, options) =>
				new Response(
					JSON.stringify({
						capabilities:
							JSON.parse(options.body).model === "visual"
								? ["vision", "thinking", "completion"]
								: ["completion"],
					}),
				),
		);
		vi.stubGlobal("fetch", fetcher);
		const result = await enrichOllamaModelCapabilities(
			{ visual: model(), text: model() },
			"ollama",
			"https://example.com/prefix/api/tags",
			{ baseUrl: "https://example.com/prefix", apiKey: "test" },
		);
		expect(result.visual).toEqual({
			supportsVision: true,
			supportsAttachments: true,
			supportsReasoning: true,
		});
		expect(result.text).toEqual(model());
		expect(fetcher.mock.calls[0][0]).toBe(
			"https://example.com/prefix/api/show",
		);
		expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer test");
	});
	it.each([
		undefined,
		"vision",
		[1],
	])("preserves fallback when capabilities are malformed: %s", async (capabilities) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ capabilities }))),
		);
		expect(
			await enrichOllamaModelCapabilities(
				{ text: model() },
				"ollama",
				"http://localhost/api/tags",
			),
		).toEqual({ text: model() });
	});
	it("survives failed requests and does not query unrelated providers", async () => {
		const fetcher = vi.fn(async () => {
			throw new Error("offline");
		});
		vi.stubGlobal("fetch", fetcher);
		expect(
			await enrichOllamaModelCapabilities(
				{ text: model() },
				"ollama",
				"http://localhost/api/tags",
			),
		).toEqual({ text: model() });
		fetcher.mockClear();
		await enrichOllamaModelCapabilities(
			{ text: model() },
			"other",
			"http://localhost/api/tags",
		);
		expect(fetcher).not.toHaveBeenCalled();
	});
});

import { fetchModelIdsFromSource } from "./model-source";

it.each([
	undefined,
	"catalog.example/v1",
	"localhost:1234",
	"/v1",
	"https://",
])("fetches public catalogs without credentials when the base URL is %s", async (baseUrl) => {
	const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
		Response.json(["public-model"]),
	);
	vi.stubGlobal("fetch", fetchMock);
	await expect(
		fetchModelIdsFromSource("https://catalog.example/models", "custom", {
			baseUrl,
			apiKey: "secret",
			headers: { "X-Secret": "secret" },
		}),
	).resolves.toEqual(["public-model"]);
	expect(fetchMock).toHaveBeenCalledOnce();
	expect([...new Headers(fetchMock.mock.calls[0][1].headers)]).toEqual([]);
});

it("honors explicit authorization headers without duplicating bearer auth", async () => {
	const fetchMock = vi.fn(
		async (_url: string, _init: RequestInit) => new Response('["agent_test"]'),
	);
	vi.stubGlobal("fetch", fetchMock);
	await fetchModelIdsFromSource("https://host.example/models", "custom", {
		baseUrl: "https://host.example/v1",
		apiKey: "key",
		headers: { authorization: "Basic custom" },
	});
	const init = fetchMock.mock.calls[0][1];
	expect([...new Headers(init.headers)]).toEqual([
		["authorization", "Basic custom"],
	]);
	expect(init.redirect).toBe("error");
});

it("does not send provider credentials to a different origin", async () => {
	const fetchMock = vi.fn(
		async (_url: string, _init: RequestInit) =>
			new Response('["public-model"]'),
	);
	vi.stubGlobal("fetch", fetchMock);
	await fetchModelIdsFromSource("https://catalog.example/models", "custom", {
		baseUrl: "https://host.example/v1",
		apiKey: "secret",
		headers: { "X-Secret": "secret" },
	});
	const init = fetchMock.mock.calls[0][1];
	expect([...new Headers(init.headers)]).toEqual([]);
});

describe("Ollama capability discovery boundaries", () => {
	it("keeps credentials at the provider origin and refuses redirects", async () => {
		const mock = vi.fn(async (_url: string, _init: RequestInit) =>
			Response.json({ capabilities: ["vision"] }),
		);
		vi.stubGlobal("fetch", mock);
		await enrichOllamaModelCapabilities(
			{ visual: model() },
			"ollama",
			"https://catalog.example/api/tags",
			{
				baseUrl: "https://provider.example",
				apiKey: "test",
				headers: { "X-Key": "test" },
			},
		);
		expect(mock.mock.calls[0][1].headers).toEqual({
			"Content-Type": "application/json",
		});
		expect(mock.mock.calls[0][1].redirect).toBe("error");
	});
	it("preserves model flags for invalid source URLs", async () => {
		const mock = vi.fn();
		vi.stubGlobal("fetch", mock);
		expect(
			await enrichOllamaModelCapabilities(
				{ text: model() },
				"ollama",
				"not a URL",
			),
		).toEqual({ text: model() });
		expect(mock).not.toHaveBeenCalled();
	});
});
