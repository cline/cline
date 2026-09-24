import type { AgentMessage } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createGateway } from "../gateway";

describe("bedrock cache-point wire format", () => {
	it("places one cache point after the latest tool result", async () => {
		let requestBody: Record<string, unknown> | undefined;
		const fetchMock = vi.fn(
			async (
				_input: Parameters<typeof fetch>[0],
				init?: Parameters<typeof fetch>[1],
			) => {
				requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
				return new Response(JSON.stringify({ message: "request captured" }), {
					status: 400,
					headers: { "content-type": "application/json" },
				});
			},
		);
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "bedrock",
					apiKey: "test",
					fetch: fetchMock as typeof fetch,
					options: { region: "us-east-1" },
					models: [
						{
							id: "anthropic.claude-sonnet-4-6",
							name: "Claude Sonnet 4.6",
						},
					],
				},
			],
		});
		const messages: AgentMessage[] = [
			{
				id: "user-1",
				role: "user",
				content: [{ type: "text", text: "Read the first file" }],
				createdAt: 1,
			},
			{
				id: "assistant-1",
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call-1",
						toolName: "read_file",
						input: { path: "first.txt" },
					},
				],
				createdAt: 2,
			},
			{
				id: "user-2",
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call-1",
						toolName: "read_file",
						output: "first result",
					},
				],
				createdAt: 3,
			},
			{
				id: "assistant-2",
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call-2",
						toolName: "read_file",
						input: { path: "second.txt" },
					},
				],
				createdAt: 4,
			},
			{
				id: "user-3",
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call-2",
						toolName: "read_file",
						output: "second result",
					},
				],
				createdAt: 5,
			},
		];

		const stream = await gateway.stream({
			providerId: "bedrock",
			modelId: "anthropic.claude-sonnet-4-6",
			messages,
			tools: [
				{
					name: "read_file",
					description: "Read a file",
					inputSchema: {
						type: "object",
						properties: { path: { type: "string" } },
						required: ["path"],
					},
				},
			],
		});
		try {
			for await (const _event of stream) {
				// Drain the stream so the mocked request is sent.
			}
		} catch {
			// The controlled 400 response is expected after request capture.
		}

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(requestBody).toBeDefined();
		const bedrockMessages = requestBody?.messages as Array<{
			role: string;
			content: Array<Record<string, unknown>>;
		}>;
		const lastMessage = bedrockMessages.at(-1);
		expect(lastMessage?.role).toBe("user");
		expect(lastMessage?.content).toEqual([
			{
				toolResult: {
					toolUseId: "call-2",
					content: [{ text: "second result" }],
				},
			},
			{ cachePoint: { type: "default" } },
		]);
		expect(
			bedrockMessages
				.slice(0, -1)
				.flatMap((message) => message.content)
				.some((part) => "cachePoint" in part),
		).toBe(false);
		expect(bedrockMessages.every((message) => message.content.length > 0)).toBe(
			true,
		);
		expect(JSON.stringify(requestBody)).not.toContain("cache_control");
	});
});
