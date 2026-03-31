import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../types/messages";
import type { ApiStreamChunk } from "../types/stream";

const generateContentStreamSpy = vi.fn();
const googleGenAIConstructorSpy = vi.fn();

vi.mock("@google/genai", () => {
	class GoogleGenAI {
		models = {
			generateContentStream: generateContentStreamSpy,
		};

		constructor(config: unknown) {
			googleGenAIConstructorSpy(config);
		}
	}

	return {
		GoogleGenAI,
		FunctionCallingConfigMode: { AUTO: "AUTO" },
		ThinkingLevel: { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" },
	};
});

import { GeminiHandler } from "./gemini-base";

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

describe("GeminiHandler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("preserves per-call ids for parallel function calls and keeps falsy args", async () => {
		generateContentStreamSpy.mockResolvedValue(
			createAsyncIterable([
				{
					candidates: [
						{
							content: {
								parts: [
									{
										functionCall: {
											id: "call_a",
											name: "power_disco_ball",
											args: { power: false },
										},
									},
									{
										functionCall: {
											id: "call_b",
											name: "dim_lights",
											args: { brightness: 0 },
										},
									},
								],
							},
						},
					],
					usageMetadata: {
						promptTokenCount: 10,
						candidatesTokenCount: 4,
					},
				},
			]),
		);

		const handler = new GeminiHandler({
			providerId: "gemini",
			modelId: "gemini-2.5-flash",
			apiKey: "test-key",
			modelInfo: {
				id: "gemini-2.5-flash",
				contextWindow: 1_000_000,
				maxTokens: 8192,
				temperature: 1,
			},
		});

		const tools: ToolDefinition[] = [
			{
				name: "power_disco_ball",
				description: "toggle disco ball power",
				inputSchema: {
					type: "object",
					properties: { power: { type: "boolean" } },
					required: ["power"],
				},
			},
			{
				name: "dim_lights",
				description: "set light brightness",
				inputSchema: {
					type: "object",
					properties: { brightness: { type: "number" } },
					required: ["brightness"],
				},
			},
		];

		const chunks = await collectChunks(
			handler.createMessage(
				"You are helpful.",
				[{ role: "user", content: "start" }],
				tools,
			),
		);

		const toolChunks = chunks.filter((chunk) => chunk.type === "tool_calls");
		expect(toolChunks).toHaveLength(2);
		expect(toolChunks[0]).toMatchObject({
			tool_call: {
				call_id: "call_a",
				function: {
					id: "call_a",
					name: "power_disco_ball",
					arguments: { power: false },
				},
			},
		});
		expect(toolChunks[1]).toMatchObject({
			tool_call: {
				call_id: "call_b",
				function: {
					id: "call_b",
					name: "dim_lights",
					arguments: { brightness: 0 },
				},
			},
		});
	});

	it("generates distinct fallback ids when Gemini omits functionCall.id", async () => {
		generateContentStreamSpy.mockResolvedValue(
			createAsyncIterable([
				{
					candidates: [
						{
							content: {
								parts: [
									{
										functionCall: {
											name: "read_file",
											args: { path: "a.ts" },
										},
									},
									{
										functionCall: {
											name: "search_files",
											args: { query: "TODO" },
										},
									},
								],
							},
						},
					],
					usageMetadata: {
						promptTokenCount: 5,
						candidatesTokenCount: 3,
					},
				},
			]),
		);

		const handler = new GeminiHandler({
			providerId: "gemini",
			modelId: "gemini-2.5-flash",
			apiKey: "test-key",
		});

		const chunks = await collectChunks(
			handler.createMessage(
				"System",
				[{ role: "user", content: "go" }],
				[
					{
						name: "read_file",
						description: "read file",
						inputSchema: {
							type: "object",
							properties: { path: { type: "string" } },
						},
					},
					{
						name: "search_files",
						description: "search files",
						inputSchema: {
							type: "object",
							properties: { query: { type: "string" } },
						},
					},
				],
			),
		);

		const toolChunks = chunks.filter((chunk) => chunk.type === "tool_calls");
		expect(toolChunks).toHaveLength(2);
		const firstId = toolChunks[0].tool_call.call_id;
		const secondId = toolChunks[1].tool_call.call_id;
		expect(firstId).toBeTruthy();
		expect(secondId).toBeTruthy();
		expect(firstId).not.toBe(secondId);
	});

	it("defaults maxOutputTokens to 8192 for gemini-3-flash when no model or config limit is provided", async () => {
		generateContentStreamSpy.mockResolvedValue(createAsyncIterable([]));

		const handler = new GeminiHandler({
			providerId: "gemini",
			modelId: "gemini-3-flash",
			apiKey: "test-key",
		});

		await collectChunks(
			handler.createMessage("System", [{ role: "user", content: "go" }]),
		);

		expect(generateContentStreamSpy).toHaveBeenCalledTimes(1);
		const request = generateContentStreamSpy.mock.calls[0]?.[0] as {
			config?: { maxOutputTokens?: number };
		};
		expect(request.config?.maxOutputTokens).toBe(8192);
	});

	it("defaults maxOutputTokens to 128000 for non gemini-3-flash models when no model or config limit is provided", async () => {
		generateContentStreamSpy.mockResolvedValue(createAsyncIterable([]));

		const handler = new GeminiHandler({
			providerId: "gemini",
			modelId: "gemini-2.5-flash",
			apiKey: "test-key",
		});

		await collectChunks(
			handler.createMessage("System", [{ role: "user", content: "go" }]),
		);

		expect(generateContentStreamSpy).toHaveBeenCalledTimes(1);
		const request = generateContentStreamSpy.mock.calls[0]?.[0] as {
			config?: { maxOutputTokens?: number };
		};
		expect(request.config?.maxOutputTokens).toBe(128000);
	});

	it("requests thought summaries for Gemini reasoning models that only advertise reasoning capability", async () => {
		generateContentStreamSpy.mockResolvedValue(createAsyncIterable([]));

		const handler = new GeminiHandler({
			providerId: "gemini",
			modelId: "google/gemini-2.5-flash",
			apiKey: "test-key",
			thinking: true,
			modelInfo: {
				id: "google/gemini-2.5-flash",
				contextWindow: 1_000_000,
				maxTokens: 8192,
				temperature: 1,
				capabilities: ["reasoning"],
			},
		});

		await collectChunks(
			handler.createMessage("System", [{ role: "user", content: "go" }]),
		);

		const request = generateContentStreamSpy.mock.calls[0]?.[0] as {
			config?: {
				thinkingConfig?: {
					includeThoughts?: boolean;
					thinkingBudget?: number;
					thinkingLevel?: string;
				};
			};
		};
		expect(request.config?.thinkingConfig).toMatchObject({
			includeThoughts: true,
			thinkingBudget: 1024,
		});
		expect(request.config?.thinkingConfig?.thinkingLevel).toBeUndefined();
	});

	it("uses Gemini 3 thinking levels and streams thought summaries as reasoning chunks", async () => {
		generateContentStreamSpy.mockResolvedValue(
			createAsyncIterable([
				{
					candidates: [
						{
							content: {
								parts: [
									{
										text: "First inspect the repo layout.",
										thought: true,
										thoughtSignature: "sig-thought",
									},
									{
										text: "This repo is an SDK workspace.",
									},
								],
							},
						},
					],
					usageMetadata: {
						promptTokenCount: 8,
						candidatesTokenCount: 5,
						thoughtsTokenCount: 3,
					},
				},
			]),
		);

		const handler = new GeminiHandler({
			providerId: "gemini",
			modelId: "google/gemini-3-flash-preview",
			apiKey: "test-key",
			thinking: true,
			reasoningEffort: "medium",
			modelInfo: {
				id: "google/gemini-3-flash-preview",
				contextWindow: 1_000_000,
				maxTokens: 8192,
				temperature: 1,
				capabilities: ["reasoning"],
			},
		});

		const chunks = await collectChunks(
			handler.createMessage("System", [{ role: "user", content: "go" }]),
		);

		expect(chunks).toContainEqual(
			expect.objectContaining({
				type: "reasoning",
				reasoning: "First inspect the repo layout.",
				signature: "sig-thought",
			}),
		);
		expect(chunks).toContainEqual(
			expect.objectContaining({
				type: "text",
				text: "This repo is an SDK workspace.",
			}),
		);
		expect(chunks).toContainEqual(
			expect.objectContaining({
				type: "usage",
				thoughtsTokenCount: 3,
			}),
		);

		const request = generateContentStreamSpy.mock.calls[0]?.[0] as {
			config?: {
				thinkingConfig?: {
					includeThoughts?: boolean;
					thinkingBudget?: number;
					thinkingLevel?: string;
				};
			};
		};
		expect(request.config?.thinkingConfig).toMatchObject({
			includeThoughts: true,
			thinkingLevel: "MEDIUM",
		});
		expect(request.config?.thinkingConfig?.thinkingBudget).toBeUndefined();
	});
});
