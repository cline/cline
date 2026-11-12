import type { AgentMessage } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createGateway } from "../gateway";

type AnthropicBlock = Record<string, unknown> & { type: string };
type AnthropicMessage = { role: string; content: AnthropicBlock[] };

/**
 * Run a request through the real gateway + `@ai-sdk/anthropic` pipeline and
 * return the JSON body that would be POSTed to `/v1/messages`. No network
 * traffic is sent: the mocked fetch captures the body and answers with a 400.
 */
async function captureAnthropicRequest(
	messages: AgentMessage[],
	modelId = "claude-sonnet-4-5",
): Promise<Record<string, unknown>> {
	let requestBody: Record<string, unknown> | undefined;
	const fetchMock = vi.fn(
		async (
			_input: Parameters<typeof fetch>[0],
			init?: Parameters<typeof fetch>[1],
		) => {
			requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					type: "error",
					error: { type: "invalid_request_error", message: "captured" },
				}),
				{ status: 400, headers: { "content-type": "application/json" } },
			);
		},
	);
	const gateway = createGateway({
		providerConfigs: [
			{
				providerId: "anthropic",
				apiKey: "test",
				fetch: fetchMock as typeof fetch,
			},
		],
	});
	const stream = await gateway.stream({
		providerId: "anthropic",
		modelId,
		systemPrompt: "You are Cline.",
		messages,
		tools: [
			{
				name: "read_files",
				description: "Read files",
				inputSchema: {
					type: "object",
					properties: { paths: { type: "array", items: { type: "string" } } },
					required: ["paths"],
				},
			},
		],
	});
	try {
		for await (const _event of stream) {
			// Drain the stream so the mocked request is sent.
		}
	} catch {
		// The controlled 400 response is expected after the request is captured.
	}
	expect(fetchMock).toHaveBeenCalledTimes(1);
	if (!requestBody) {
		throw new Error("Expected the mocked fetch to capture a request body");
	}
	return requestBody;
}

/** Every content block in the request that carries a cache breakpoint. */
function cachedBlocks(body: Record<string, unknown>): AnthropicBlock[] {
	const messages = body.messages as AnthropicMessage[];
	return messages.flatMap((message) =>
		message.content.filter((block) => block.cache_control),
	);
}

/** True when the request's final content block is covered by a cache breakpoint. */
function lastBlockIsCached(body: Record<string, unknown>): boolean {
	if (body.cache_control) {
		// Top-level automatic caching: Anthropic places the breakpoint on the
		// last cacheable block and advances it as the conversation grows.
		return true;
	}
	const messages = body.messages as AnthropicMessage[];
	const lastBlock = messages.at(-1)?.content.at(-1);
	return Boolean(lastBlock?.cache_control);
}

const createdAt = 1;
const userPrompt: AgentMessage = {
	id: "user-1",
	role: "user",
	content: [{ type: "text", text: "Fix the bug" }],
	createdAt,
};

function toolRound(n: number): AgentMessage[] {
	return [
		{
			id: `assistant-${n}`,
			role: "assistant",
			content: [
				{
					type: "tool-call",
					toolCallId: `call-${n}`,
					toolName: "read_files",
					input: { paths: [`file-${n}.ts`] },
				},
			],
			createdAt,
		},
		{
			id: `tool-${n}`,
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: `call-${n}`,
					toolName: "read_files",
					output: `contents of file-${n}.ts`,
				},
			],
			createdAt,
		},
	];
}

describe("anthropic prompt-cache wire format", () => {
	it("caches the opening user prompt", async () => {
		const body = await captureAnthropicRequest([userPrompt]);
		expect(lastBlockIsCached(body)).toBe(true);
	});

	it("advances the cache breakpoint through tool-result continuations", async () => {
		const body = await captureAnthropicRequest([
			userPrompt,
			...toolRound(1),
			...toolRound(2),
		]);
		// Before the fix the only breakpoint stayed on messages[0] (the original
		// user prompt), so every assistant/tool turn after it was re-sent
		// uncached on every request of the agent loop.
		expect(lastBlockIsCached(body)).toBe(true);
		const lastBlock = (body.messages as AnthropicMessage[])
			.at(-1)
			?.content.at(-1);
		expect(lastBlock).toMatchObject({
			type: "tool_result",
			tool_use_id: "call-2",
			cache_control: { type: "ephemeral" },
		});
		// The breakpoint moves rather than multiplying, so long loops never
		// approach Anthropic's four-breakpoint limit.
		expect(cachedBlocks(body)).toHaveLength(1);
	});

	it("caches the last tool result when one step returns several", async () => {
		const body = await captureAnthropicRequest([
			userPrompt,
			{
				id: "assistant-parallel",
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call-a",
						toolName: "read_files",
						input: { paths: ["a.ts"] },
					},
					{
						type: "tool-call",
						toolCallId: "call-b",
						toolName: "read_files",
						input: { paths: ["b.ts"] },
					},
				],
				createdAt,
			},
			{
				id: "tool-parallel",
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call-a",
						toolName: "read_files",
						output: "contents of a.ts",
					},
					{
						type: "tool-result",
						toolCallId: "call-b",
						toolName: "read_files",
						output: "contents of b.ts",
					},
				],
				createdAt,
			},
		]);
		expect(cachedBlocks(body)).toEqual([
			expect.objectContaining({
				type: "tool_result",
				tool_use_id: "call-b",
				cache_control: { type: "ephemeral" },
			}),
		]);
	});

	it("caches a new human turn after a tool round", async () => {
		const body = await captureAnthropicRequest([
			userPrompt,
			...toolRound(1),
			{
				id: "assistant-done",
				role: "assistant",
				content: [{ type: "text", text: "Done." }],
				createdAt,
			},
			{
				id: "user-2",
				role: "user",
				content: [{ type: "text", text: "Now add a test" }],
				createdAt,
			},
		]);
		expect(lastBlockIsCached(body)).toBe(true);
		expect(cachedBlocks(body)).toHaveLength(1);
	});
});
