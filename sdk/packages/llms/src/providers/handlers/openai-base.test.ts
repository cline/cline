import { zodToJsonSchema } from "@clinebot/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ApiStreamChunk } from "../types/stream";

const TeamTaskInputSchema = z.object({
	task: z.string(),
	details: z
		.object({
			priority: z.enum(["low", "high"]).optional(),
			notes: z.string().optional(),
		})
		.optional(),
});

const chatCompletionsCreateSpy = vi.fn();

beforeEach(() => {
	chatCompletionsCreateSpy.mockClear();
});

vi.mock("openai", () => {
	class OpenAI {
		chat = {
			completions: {
				create: chatCompletionsCreateSpy,
			},
		};
	}

	return {
		default: OpenAI,
	};
});

import { OpenAIBaseHandler } from "./openai-base";

function createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
	return {
		async *[Symbol.asyncIterator]() {
			for (const item of items) {
				yield item;
			}
		},
	};
}

async function collectChunks(stream: AsyncIterable<ApiStreamChunk>) {
	const chunks: ApiStreamChunk[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}
	return chunks;
}

describe("OpenAIBaseHandler", () => {
	it("forwards team_task optional-field schemas with strict=true on chat-completions requests", async () => {
		chatCompletionsCreateSpy.mockResolvedValueOnce(createAsyncIterable([]));

		const teamTaskSchema = zodToJsonSchema(TeamTaskInputSchema);
		const handler = new OpenAIBaseHandler({
			providerId: "openai-compatible",
			modelId: "gpt-4.1",
			apiKey: "test-key",
			baseUrl: "https://example.com",
		});

		await collectChunks(
			handler.createMessage(
				"system",
				[{ role: "user", content: "List ready tasks" }],
				[
					{
						name: "team_task",
						description: "Manage shared team tasks.",
						inputSchema: teamTaskSchema,
					},
				],
			),
		);

		expect(chatCompletionsCreateSpy).toHaveBeenCalledTimes(1);
		const request = chatCompletionsCreateSpy.mock.calls[0]?.[0] as {
			tools?: Array<{
				type: string;
				function: {
					name: string;
					description: string;
					parameters: unknown;
					strict: boolean;
				};
			}>;
		};
		expect(request.tools).toEqual([
			{
				type: "function",
				function: {
					name: "team_task",
					description: "Manage shared team tasks.",
					parameters: teamTaskSchema,
					strict: true,
				},
			},
		]);
	});
});
