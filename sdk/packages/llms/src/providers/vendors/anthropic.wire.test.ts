// Exercise the builtin provider routing through the real Anthropic adapter.
// The fetch stub returns 400 because only the outgoing request is under test.
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

async function wireRequest(input: {
	providerId: "anthropic" | "minimax";
	baseUrl?: string;
}): Promise<{ url: string; headers: Headers }> {
	let request: { url: string; headers: Headers } | undefined;
	const fetchStub = (async (url, init) => {
		request = {
			url: url instanceof Request ? url.url : String(url),
			headers: new Headers(init?.headers),
		};
		return new Response(
			JSON.stringify({
				type: "error",
				error: { type: "invalid_request_error", message: "stub" },
			}),
			{
				status: 400,
				headers: { "content-type": "application/json" },
			},
		);
	}) as typeof fetch;
	const gateway = createGateway({
		providerConfigs: [
			{
				providerId: input.providerId,
				...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
				apiKey: "test-api-key",
				headers: { "x-test-gateway": "custom-header" },
				fetch: fetchStub,
			},
		],
	});
	for await (const _event of await gateway.stream({
		providerId: input.providerId,
		modelId:
			input.providerId === "minimax" ? "MiniMax-M2.5" : "claude-sonnet-4-5",
		maxTokens: 16,
		messages: [
			{
				id: "m1",
				role: "user",
				content: [{ type: "text", text: "hi" }],
				createdAt: 0,
			},
		],
	})) {
		// drain
	}
	if (!request) {
		throw new Error("the stubbed fetch was never called");
	}
	return request;
}

describe("Anthropic base URL wire contract", () => {
	it.each([
		[undefined, "https://api.anthropic.com/v1/messages"],
		["https://gateway.example", "https://gateway.example/v1/messages"],
		["https://gateway.example/", "https://gateway.example/v1/messages"],
		["https://gateway.example/v1", "https://gateway.example/v1/messages"],
		["https://gateway.example/v1/", "https://gateway.example/v1/messages"],
		[
			"https://gateway.example/proxy/v1",
			"https://gateway.example/proxy/v1/messages",
		],
		[
			"https://gateway.example/custom",
			"https://gateway.example/custom/messages",
		],
	] as const)("sends base URL %s to %s", async (baseUrl, expectedUrl) => {
		const request = await wireRequest({ providerId: "anthropic", baseUrl });
		expect(request.url).toBe(expectedUrl);
		expect(request.headers.get("x-api-key")).toBe("test-api-key");
		expect(request.headers.get("anthropic-version")).toBe("2023-06-01");
		expect(request.headers.get("x-test-gateway")).toBe("custom-header");
	});

	it.each([
		["https://gateway.example", "https://gateway.example/messages"],
		[
			"https://gateway.example/anthropic",
			"https://gateway.example/anthropic/messages",
		],
	] as const)("preserves MiniMax base URL %s", async (baseUrl, expectedUrl) => {
		const request = await wireRequest({ providerId: "minimax", baseUrl });
		expect(request.url).toBe(expectedUrl);
		expect(request.headers.get("x-api-key")).toBe("test-api-key");
		expect(request.headers.get("anthropic-version")).toBe("2023-06-01");
		expect(request.headers.get("x-test-gateway")).toBe("custom-header");
	});
});
