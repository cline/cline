import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../types/messages";

const { streamTextSpy, createVertexAnthropicSpy, vertexProviderSpy } =
	vi.hoisted(() => {
		const provider = vi.fn();
		return {
			streamTextSpy: vi.fn(),
			createVertexAnthropicSpy: vi.fn(() => provider),
			vertexProviderSpy: provider,
		};
	});

const geminiConstructorSpy = vi.fn();
const geminiGetMessagesSpy = vi.fn();
const geminiCreateMessageSpy = vi.fn();

vi.mock("ai", () => ({
	streamText: streamTextSpy,
}));

vi.mock("@ai-sdk/google-vertex/anthropic", () => ({
	createVertexAnthropic: createVertexAnthropicSpy,
}));

vi.mock("./gemini", () => {
	return {
		GeminiHandler: class {
			constructor(config: unknown) {
				geminiConstructorSpy(config);
			}

			getMessages(systemPrompt: string, messages: Message[]) {
				return geminiGetMessagesSpy(systemPrompt, messages);
			}

			createMessage(
				systemPrompt: string,
				messages: Message[],
				tools?: unknown[],
			) {
				return geminiCreateMessageSpy(systemPrompt, messages, tools);
			}

			getModel() {
				return {
					id: "gemini-2.5-pro",
					info: {
						id: "gemini-2.5-pro",
						name: "Gemini 2.5 Pro",
						contextWindow: 1,
						maxTokens: 1,
					},
				};
			}
		},
	};
});

import { VertexHandler } from "./vertex";

describe("VertexHandler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vertexProviderSpy.mockReturnValue({ provider: "vertex-model" });
		streamTextSpy.mockReturnValue({
			fullStream: createAsyncIterable([{ type: "finish", usage: {} }]),
		});
	});

	it("routes Gemini models through GeminiHandler with Vertex config defaults", () => {
		geminiGetMessagesSpy.mockReturnValue([
			{ role: "user", parts: [{ text: "ok" }] },
		]);

		const handler = new VertexHandler({
			providerId: "vertex",
			modelId: "gemini-2.5-pro",
			gcp: { projectId: "my-project" },
		});

		const messages: Message[] = [{ role: "user", content: "Hello" }];
		const converted = handler.getMessages("You are helpful.", messages);

		expect(geminiConstructorSpy).toHaveBeenCalledTimes(1);
		expect(geminiConstructorSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				region: "us-central1",
				gcp: expect.objectContaining({
					projectId: "my-project",
					region: "us-central1",
				}),
			}),
		);
		expect(geminiGetMessagesSpy).toHaveBeenCalledWith(
			"You are helpful.",
			messages,
		);
		expect(converted).toEqual([{ role: "user", parts: [{ text: "ok" }] }]);
	});

	it("uses Anthropic-style message conversion for Claude models", () => {
		const handler = new VertexHandler({
			providerId: "vertex",
			modelId: "claude-sonnet-4-5",
			gcp: { projectId: "my-project", region: "us-east5" },
		});

		const converted = handler.getMessages("System", [
			{ role: "user", content: "Hello Claude" },
		]);

		expect(geminiGetMessagesSpy).not.toHaveBeenCalled();
		expect(converted).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "Hello Claude" }],
			},
		]);
	});

	it("requires gcp.projectId for Vertex provider", async () => {
		const handler = new VertexHandler({
			providerId: "vertex",
			modelId: "gemini-2.5-pro",
		});

		const stream = handler.createMessage("System", [
			{ role: "user", content: "Hello" },
		]);
		await expect(stream.next()).rejects.toThrow("gcp.projectId");
	});

	it("requires region for Claude models on Vertex", async () => {
		const handler = new VertexHandler({
			providerId: "vertex",
			modelId: "claude-sonnet-4-5",
			gcp: { projectId: "my-project" },
		});

		const stream = handler.createMessage("System", [
			{ role: "user", content: "Hello" },
		]);
		await expect(stream.next()).rejects.toThrow("gcp.region");
	});

	it("prices Claude cache usage from inclusive input tokens", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: createAsyncIterable([
				{
					type: "finish",
					usage: {
						inputTokens: 1000,
						outputTokens: 50,
						cachedInputTokens: 900,
					},
					providerMetadata: {
						anthropic: {
							cacheCreationInputTokens: 80,
						},
					},
				},
			]),
		});

		const handler = new VertexHandler({
			providerId: "vertex",
			modelId: "claude-sonnet-4-5",
			gcp: { projectId: "my-project", region: "us-east5" },
			modelInfo: {
				id: "claude-sonnet-4-5",
				contextWindow: 1_000_000,
				maxTokens: 8192,
				pricing: {
					input: 1,
					output: 2,
					cacheRead: 0.5,
					cacheWrite: 1.25,
				},
			},
		});

		const chunks = [];
		for await (const chunk of handler.createMessage("System", [
			{ role: "user", content: "Hello" },
		])) {
			chunks.push(chunk);
		}

		expect(chunks).toContainEqual(
			expect.objectContaining({
				type: "usage",
				inputTokens: 1000,
				outputTokens: 50,
				cacheReadTokens: 900,
				cacheWriteTokens: 80,
				totalCost: expect.closeTo(0.00067, 10),
			}),
		);
	});
});

function createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
	return {
		async *[Symbol.asyncIterator]() {
			for (const item of items) {
				yield item;
			}
		},
	};
}
