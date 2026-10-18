import { afterEach, expect, it, vi } from "vitest";
import {
	extractModelEntriesFromPayload,
	fetchModelEntriesFromSource,
	fetchModelIdsFromSource,
} from "./model-source";

afterEach(() => vi.unstubAllGlobals());

it("keeps model limits from array-shaped catalogs", () => {
	expect(
		extractModelEntriesFromPayload(
			{
				data: [
					{
						id: "long-context-model",
						context_length: 1_048_576,
						max_completion_tokens: 32_768,
					},
					{ id: "id-only" },
				],
			},
			"custom",
		),
	).toEqual([
		{
			id: "long-context-model",
			name: undefined,
			contextWindow: 1_048_576,
			maxInputTokens: 1_048_576,
			maxTokens: 32_768,
		},
		{
			id: "id-only",
			name: undefined,
			contextWindow: undefined,
			maxInputTokens: undefined,
			maxTokens: undefined,
		},
	]);
});

it("keeps model limits from id-keyed and provider-scoped catalogs", () => {
	expect(
		extractModelEntriesFromPayload(
			{ models: { "map-model": { context_window: 131_072 } } },
			"custom",
		),
	).toMatchObject([
		{
			id: "map-model",
			contextWindow: 131_072,
			maxInputTokens: 131_072,
		},
	]);
	expect(
		extractModelEntriesFromPayload(
			{
				providers: {
					custom: {
						models: {
							"scoped-model": { context_length: 200_000 },
						},
					},
				},
			},
			"custom",
		),
	).toMatchObject([
		{
			id: "scoped-model",
			contextWindow: 200_000,
			maxInputTokens: 200_000,
		},
	]);
});

it("fetches entries with their limits, while the id helper stays compatible", async () => {
	const payload = {
		data: [{ id: "long-context-model", context_length: 1_048_576 }],
	};
	const fetchMock = vi.fn(async () => Response.json(payload));
	vi.stubGlobal("fetch", fetchMock);

	await expect(
		fetchModelEntriesFromSource("https://host.example/v1/models", "custom"),
	).resolves.toMatchObject([
		{
			id: "long-context-model",
			contextWindow: 1_048_576,
			maxInputTokens: 1_048_576,
		},
	]);
	await expect(
		fetchModelIdsFromSource("https://host.example/v1/models", "custom"),
	).resolves.toEqual(["long-context-model"]);
	expect(fetchMock).toHaveBeenCalledTimes(2);
});

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
