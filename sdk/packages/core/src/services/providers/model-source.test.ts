import { afterEach, expect, it, vi } from "vitest";
import { fetchModelIdsFromSource } from "./model-source";

afterEach(() => vi.unstubAllGlobals());

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
