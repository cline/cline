// Wire-contract tests for Anthropic prompt caching, exercised through the
// *real* `@ai-sdk/anthropic` adapter (anthropic.test.ts mocks it). Each case
// streams one turn through the gateway with a stubbed fetch and asserts on the
// Messages request body. They pin:
//
//   1. the top-level `cache_control` (automatic caching) reaches the body. The
//      adapter reads that field only from the camelCase `cacheControl`
//      provider option and strips `cache_control`, so the snake-case key sent
//      nothing;
//   2. the explicit breakpoint stays on the person's message, so the request
//      stays within Anthropic's four breakpoints.
import type { AgentMessage } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

async function wireBody(
	messages: AgentMessage[],
): Promise<Record<string, unknown>> {
	let body: Record<string, unknown> | undefined;
	const fetchStub = (async (_input, init) => {
		body = JSON.parse((init?.body as string) ?? "{}");
		return new Response(
			JSON.stringify({ type: "error", error: { message: "stub" } }),
			{ status: 400, headers: { "content-type": "application/json" } },
		);
	}) as typeof fetch;
	const gateway = createGateway({
		providerConfigs: [
			{ providerId: "anthropic", apiKey: "test-key", fetch: fetchStub },
		],
	});
	for await (const _event of await gateway.stream({
		providerId: "anthropic",
		modelId: "claude-sonnet-5-5",
		systemPrompt: "You are Cline.",
		maxTokens: 16,
		messages,
	})) {
		// drain
	}
	if (!body) throw new Error("the stubbed fetch was never called");
	return body;
}

function cacheMarkers(value: unknown, path = "$"): string[] {
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, child]) => {
		const at = `${path}.${key}`;
		return key === "cache_control" ? [at] : cacheMarkers(child, at);
	});
}

describe("Anthropic prompt-cache wire contract", () => {
	it("sends automatic caching at the top level and one breakpoint on the person's message", async () => {
		const body = await wireBody([
			{
				id: "u",
				role: "user",
				createdAt: 0,
				content: [{ type: "text", text: "Fix the retry bug" }],
			},
			{
				id: "a",
				role: "assistant",
				createdAt: 1,
				content: [
					{
						type: "tool-call",
						toolCallId: "t1",
						toolName: "read_files",
						input: { paths: ["src/retry.ts"] },
					},
				],
			},
			{
				id: "r",
				role: "tool",
				createdAt: 2,
				content: [
					{
						type: "tool-result",
						toolCallId: "t1",
						toolName: "read_files",
						output: "export function retry() {}",
					},
				],
			},
		]);
		expect(body.cache_control).toEqual({ type: "ephemeral" });
		expect(cacheMarkers(body)).toEqual([
			"$.cache_control",
			"$.messages.0.content.0.cache_control",
		]);
	});
});
