import type { AgentToolContext } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebFetchExecutor } from "./web-fetch";

const ctx: AgentToolContext = {
	agentId: "agent-1",
	conversationId: "conv-1",
	iteration: 1,
};

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
}

function textResponse(body: string, contentType = "text/plain"): Response {
	return new Response(body, {
		status: 200,
		headers: { "content-type": contentType },
	});
}

function redirectResponse(location: string, status = 302): Response {
	return new Response(null, {
		status,
		headers: { location },
	});
}

describe("createWebFetchExecutor SSRF guard", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it.each([
		"http://127.0.0.1:9191/secret.txt",
		"http://localhost/secret",
		"http://[::1]/secret",
		"http://[::ffff:127.0.0.1]/secret",
		"http://169.254.169.254/latest/meta-data/iam/security-credentials/role",
		"http://[::ffff:169.254.169.254]/latest/meta-data/",
		"http://[fe80::1]/secret",
	])("rejects %s without fetching", async (url) => {
		const fetchMock = vi.fn(async () => textResponse("SECRET"));
		vi.stubGlobal("fetch", fetchMock);

		const webFetch = createWebFetchExecutor();
		await expect(webFetch(url, "summarize", ctx)).rejects.toThrow(
			/loopback, link-local, or cloud-metadata/i,
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("fetches a public URL", async () => {
		const fetchMock = vi.fn(async () => textResponse("public docs"));
		vi.stubGlobal("fetch", fetchMock);

		const webFetch = createWebFetchExecutor();
		const result = await webFetch(
			"https://example.com/docs",
			"extract the API section",
			ctx,
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(requestUrl(fetchMock.mock.calls[0][0] as RequestInfo | URL)).toBe(
			"https://example.com/docs",
		);
		expect(result).toContain("public docs");
		expect(result).toContain("Prompt: extract the API section");
	});

	it("follows a public redirect to another public URL", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const href = requestUrl(input);
			if (href === "https://example.com/start") {
				return redirectResponse("https://cdn.example.com/final");
			}
			if (href === "https://cdn.example.com/final") {
				return textResponse("redirected public content");
			}
			throw new Error(`unexpected fetch: ${href}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const webFetch = createWebFetchExecutor();
		const result = await webFetch(
			"https://example.com/start",
			"summarize",
			ctx,
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(requestUrl(fetchMock.mock.calls[0][0] as RequestInfo | URL)).toBe(
			"https://example.com/start",
		);
		expect(requestUrl(fetchMock.mock.calls[1][0] as RequestInfo | URL)).toBe(
			"https://cdn.example.com/final",
		);
		expect(result).toContain("redirected public content");
	});

	it.each([
		"http://169.254.169.254/latest/meta-data/",
		"http://127.0.0.1/secret",
		"http://[::1]/secret",
		"http://localhost/secret",
		"http://[fe80::1]/secret",
		"http://[::ffff:169.254.169.254]/latest/meta-data/",
	])("does not follow a public redirect to %s", async (blockedLocation) => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const href = requestUrl(input);
			if (href === "https://example.com/open-redirect") {
				return redirectResponse(blockedLocation);
			}
			return textResponse("should not be fetched");
		});
		vi.stubGlobal("fetch", fetchMock);

		const webFetch = createWebFetchExecutor();
		await expect(
			webFetch("https://example.com/open-redirect", "summarize", ctx),
		).rejects.toThrow(/loopback, link-local, or cloud-metadata/i);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(requestUrl(fetchMock.mock.calls[0][0] as RequestInfo | URL)).toBe(
			"https://example.com/open-redirect",
		);
	});
});
