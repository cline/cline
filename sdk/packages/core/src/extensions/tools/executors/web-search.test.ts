import type { AgentToolContext } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createClineWebSearchExecutor } from "./web-search";

function createContext(overrides: Partial<AgentToolContext> = {}) {
	return {
		sessionId: "session-123",
		...overrides,
	} as AgentToolContext;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
		...init,
	});
}

describe("createClineWebSearchExecutor", () => {
	it("posts the query to the Cline websearch endpoint and formats results", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({
				data: {
					results: [
						{ title: "Result One", url: "https://one.example.com" },
						{ title: "Result Two", url: "https://two.example.com" },
					],
				},
			}),
		);
		const executor = createClineWebSearchExecutor({
			getAuthToken: () => "token-abc",
			apiBaseUrl: "https://api.cline.test",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const result = await executor({ query: "latest news" }, createContext());

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://api.cline.test/api/v1/search/websearch");
		expect(init.method).toBe("POST");
		expect(init.headers).toMatchObject({
			Authorization: "Bearer token-abc",
			"Content-Type": "application/json",
			"X-Task-ID": "session-123",
		});
		expect(JSON.parse(init.body as string)).toEqual({ query: "latest news" });

		expect(result).toContain("Search completed (2 results found)");
		expect(result).toContain("1. Result One");
		expect(result).toContain("https://one.example.com");
		expect(result).toContain("2. Result Two");
	});

	it("includes normalized domain filters only when provided", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({ data: { results: [] } }),
		);
		const executor = createClineWebSearchExecutor({
			getAuthToken: async () => "token-abc",
			apiBaseUrl: "https://api.cline.test",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		await executor(
			{
				query: "docs",
				allowed_domains: [" github.com ", ""],
			},
			createContext(),
		);

		const [, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(JSON.parse(init.body as string)).toEqual({
			query: "docs",
			allowed_domains: ["github.com"],
		});
	});

	it("returns an empty-result message when the API finds nothing", async () => {
		const executor = createClineWebSearchExecutor({
			getAuthToken: () => "token-abc",
			apiBaseUrl: "https://api.cline.test",
			fetchImpl: (async () =>
				jsonResponse({ data: { results: [] } })) as unknown as typeof fetch,
		});

		await expect(
			executor({ query: "nothing to see" }, createContext()),
		).resolves.toBe("Search completed (0 results found)");
	});

	it("throws a helpful error when no auth token is available", async () => {
		const fetchImpl = vi.fn();
		const executor = createClineWebSearchExecutor({
			getAuthToken: () => undefined,
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		await expect(
			executor({ query: "anything" }, createContext()),
		).rejects.toThrow(/requires a signed-in Cline account/);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("surfaces API error envelopes from non-2xx responses", async () => {
		const executor = createClineWebSearchExecutor({
			getAuthToken: () => "token-abc",
			apiBaseUrl: "https://api.cline.test",
			fetchImpl: (async () =>
				jsonResponse(
					{ error: "Not enough credits available" },
					{ status: 402 },
				)) as unknown as typeof fetch,
		});

		await expect(
			executor({ query: "anything" }, createContext()),
		).rejects.toThrow(
			"Web search failed (HTTP 402): Not enough credits available",
		);
	});

	it("rejects invalid JSON success responses", async () => {
		const executor = createClineWebSearchExecutor({
			getAuthToken: () => "token-abc",
			apiBaseUrl: "https://api.cline.test",
			fetchImpl: (async () =>
				new Response("<html>oops</html>", {
					status: 200,
				})) as unknown as typeof fetch,
		});

		await expect(
			executor({ query: "anything" }, createContext()),
		).rejects.toThrow("Web search returned invalid JSON");
	});

	it("converts an aborted request into a timeout error", async () => {
		const executor = createClineWebSearchExecutor({
			getAuthToken: () => "token-abc",
			apiBaseUrl: "https://api.cline.test",
			timeoutMs: 10,
			fetchImpl: ((_url: string, init: RequestInit) =>
				new Promise((_resolve, reject) => {
					init.signal?.addEventListener("abort", () => {
						const error = new Error("aborted");
						error.name = "AbortError";
						reject(error);
					});
				})) as unknown as typeof fetch,
		});

		await expect(
			executor({ query: "anything" }, createContext()),
		).rejects.toThrow("Web search timed out after 10ms");
	});
});
