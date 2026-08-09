import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModelIdsFromSource, resolveApiKeyFromEnv } from "./model-source";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("fetchModelIdsFromSource", () => {
	it("sends no auth header when no API key is provided", async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
			jsonResponse({ data: [{ id: "model-a" }] }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const ids = await fetchModelIdsFromSource(
			"http://localhost:1234/v1/models",
			"lmstudio",
		);

		expect(ids).toEqual(["model-a"]);
		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect(init.headers).toBeUndefined();
	});

	it("forwards the API key as a Bearer token", async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
			jsonResponse({ data: [{ id: "model-a" }] }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await fetchModelIdsFromSource(
			"http://localhost:1234/v1/models",
			"lmstudio",
			{ apiKey: "secret-token" },
		);

		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect(init.headers).toEqual({ Authorization: "Bearer secret-token" });
	});

	it("keeps a caller-supplied Authorization header over the API key", async () => {
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
			jsonResponse({ data: [{ id: "model-a" }] }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await fetchModelIdsFromSource(
			"http://localhost:1234/v1/models",
			"lmstudio",
			{
				apiKey: "secret-token",
				headers: { authorization: "Custom scheme", "x-extra": "1" },
			},
		);

		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect(init.headers).toEqual({
			authorization: "Custom scheme",
			"x-extra": "1",
		});
	});

	it("surfaces an auth hint on HTTP 401", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401)),
		);

		await expect(
			fetchModelIdsFromSource("http://localhost:1234/v1/models", "lmstudio"),
		).rejects.toThrow(
			'failed to fetch models from http://localhost:1234/v1/models: HTTP 401 (authentication failed — configure an API key for "lmstudio")',
		);
	});

	it("aborts a hung request after the timeout", async () => {
		const fetchMock = vi.fn(
			(_url: string, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						reject(init.signal?.reason ?? new Error("aborted"));
					});
				}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			fetchModelIdsFromSource("http://localhost:1234/v1/models", "lmstudio", {
				timeoutMs: 10,
			}),
		).rejects.toThrow(/timed out after 10ms/);
	});
});

describe("resolveApiKeyFromEnv", () => {
	it("returns the first non-empty env value", () => {
		vi.stubEnv("MODEL_SOURCE_TEST_KEY_A", "  ");
		vi.stubEnv("MODEL_SOURCE_TEST_KEY_B", "env-secret");

		expect(
			resolveApiKeyFromEnv([
				"MODEL_SOURCE_TEST_KEY_A",
				"MODEL_SOURCE_TEST_KEY_B",
			]),
		).toBe("env-secret");
	});

	it("returns undefined when nothing is set", () => {
		expect(resolveApiKeyFromEnv(["MODEL_SOURCE_TEST_KEY_MISSING"])).toBe(
			undefined,
		);
		expect(resolveApiKeyFromEnv(undefined)).toBe(undefined);
	});
});
