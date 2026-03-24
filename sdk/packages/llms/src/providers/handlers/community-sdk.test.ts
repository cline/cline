import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiStreamChunk } from "../types";
import {
	ClaudeCodeHandler,
	DifyHandler,
	MistralHandler,
	OpenCodeHandler,
	SapAiCoreHandler,
} from "./community-sdk";

const streamTextSpy = vi.fn();
const claudeCodeSpy = vi.fn((modelId: string) => ({ modelId }));
const opencodeSpy = vi.fn((modelId: string) => ({ modelId }));
const mistralSpy = vi.fn((modelId: string) => ({ modelId }));
const difySpy = vi.fn(
	(modelId: string, settings?: Record<string, unknown>) => ({
		modelId,
		settings,
	}),
);
const sapAiProviderSpy = vi.fn((modelId: string) => ({ modelId }));
let lastCreateSapAiProviderOptions: Record<string, unknown> | undefined;
let lastCreateDifyProviderOptions: Record<string, unknown> | undefined;

vi.mock("ai", () => ({
	streamText: (input: unknown) => streamTextSpy(input),
}));

vi.mock("ai-sdk-provider-claude-code", () => ({
	claudeCode: (modelId: string) => claudeCodeSpy(modelId),
	createClaudeCode: () => (modelId: string) => claudeCodeSpy(modelId),
}));

vi.mock("ai-sdk-provider-opencode-sdk", () => ({
	opencode: (modelId: string) => opencodeSpy(modelId),
	createOpencode: () => (modelId: string) => opencodeSpy(modelId),
}));

vi.mock("@ai-sdk/mistral", () => ({
	mistral: (modelId: string) => mistralSpy(modelId),
	createMistral: () => (modelId: string) => mistralSpy(modelId),
}));

vi.mock("dify-ai-provider", () => ({
	difyProvider: (modelId: string, settings?: Record<string, unknown>) =>
		difySpy(modelId, settings),
	createDifyProvider: (options?: Record<string, unknown>) => {
		lastCreateDifyProviderOptions = options;
		return (modelId: string, settings?: Record<string, unknown>) =>
			difySpy(modelId, settings);
	},
}));

vi.mock("@jerome-benoit/sap-ai-provider", () => ({
	sapai: (modelId: string) => sapAiProviderSpy(modelId),
	createSAPAIProvider: (options?: Record<string, unknown>) => {
		lastCreateSapAiProviderOptions = options;
		return (modelId: string) => sapAiProviderSpy(modelId);
	},
}));

async function* makeStreamParts(parts: unknown[]) {
	for (const part of parts) {
		yield part;
	}
}

describe("Community SDK handlers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		lastCreateSapAiProviderOptions = undefined;
		lastCreateDifyProviderOptions = undefined;
	});

	describe("ClaudeCodeHandler", () => {
		it("streams text and usage through AI SDK fullStream", async () => {
			streamTextSpy.mockReturnValue({
				fullStream: makeStreamParts([
					{ type: "text-delta", textDelta: "Hello" },
					{
						type: "finish",
						usage: { inputTokens: 10, outputTokens: 3 },
					},
				]),
			});

			const handler = new ClaudeCodeHandler({
				providerId: "claude-code",
				modelId: "sonnet",
			});

			const chunks: ApiStreamChunk[] = [];
			for await (const chunk of handler.createMessage("System", [
				{ role: "user", content: "Hi" },
			])) {
				chunks.push(chunk);
			}

			expect(claudeCodeSpy).toHaveBeenCalledWith("sonnet");
			expect(chunks.map((chunk) => chunk.type)).toEqual([
				"text",
				"usage",
				"done",
			]);
			const textChunk = chunks.find(
				(chunk): chunk is Extract<ApiStreamChunk, { type: "text" }> =>
					chunk.type === "text",
			);
			const usageChunk = chunks.find(
				(chunk): chunk is Extract<ApiStreamChunk, { type: "usage" }> =>
					chunk.type === "usage",
			);
			expect(textChunk?.text).toBe("Hello");
			expect(usageChunk?.inputTokens).toBe(10);
			expect(usageChunk?.outputTokens).toBe(3);
		});

		it("keeps cached input tokens separate from total input tokens", async () => {
			streamTextSpy.mockReturnValue({
				fullStream: makeStreamParts([
					{
						type: "finish",
						usage: { inputTokens: 10, outputTokens: 3, cachedInputTokens: 4 },
					},
				]),
			});

			const handler = new ClaudeCodeHandler({
				providerId: "claude-code",
				modelId: "sonnet",
			});

			const chunks: ApiStreamChunk[] = [];
			for await (const chunk of handler.createMessage("System", [
				{ role: "user", content: "Hi" },
			])) {
				chunks.push(chunk);
			}

			const usageChunk = chunks.find(
				(chunk): chunk is Extract<ApiStreamChunk, { type: "usage" }> =>
					chunk.type === "usage",
			);
			expect(usageChunk).toMatchObject({
				inputTokens: 10,
				outputTokens: 3,
				cacheReadTokens: 4,
			});
		});

		it("uses a fallback model id when model is missing", () => {
			const handler = new ClaudeCodeHandler({
				providerId: "claude-code",
				modelId: "",
			});

			expect(handler.getModel().id).toBe("sonnet");
		});
	});

	describe("MistralHandler", () => {
		it("uses a fallback model id when model is missing", () => {
			const handler = new MistralHandler({
				providerId: "mistral",
				modelId: "",
			});

			expect(handler.getModel().id).toBe("mistral-medium-latest");
		});
	});

	describe("DifyHandler", () => {
		it("passes baseURL and apiKey model settings to dify provider", async () => {
			streamTextSpy.mockReturnValue({
				fullStream: makeStreamParts([{ type: "finish", usage: {} }]),
			});

			const handler = new DifyHandler({
				providerId: "dify",
				modelId: "workflow-123",
				apiKey: "dify-key",
				baseUrl: "https://dify.example.com/v1",
			});

			for await (const _chunk of handler.createMessage("System", [
				{ role: "user", content: "Hi" },
			])) {
				// noop
			}

			expect(lastCreateDifyProviderOptions).toEqual({
				baseURL: "https://dify.example.com/v1",
			});
			expect(difySpy).toHaveBeenCalledWith("workflow-123", {
				responseMode: "blocking",
				apiKey: "dify-key",
			});
		});
	});

	describe("OpenCodeHandler", () => {
		it("streams text and usage through AI SDK fullStream", async () => {
			streamTextSpy.mockReturnValue({
				fullStream: makeStreamParts([
					{ type: "text-delta", textDelta: "Hello" },
					{
						type: "finish",
						usage: { inputTokens: 10, outputTokens: 3 },
					},
				]),
			});

			const handler = new OpenCodeHandler({
				providerId: "opencode",
				modelId: "gpt-5.1-codex",
			});

			const chunks: ApiStreamChunk[] = [];
			for await (const chunk of handler.createMessage("System", [
				{ role: "user", content: "Hi" },
			])) {
				chunks.push(chunk);
			}

			expect(opencodeSpy).toHaveBeenCalledWith("openai/gpt-5.1-codex");
			expect(chunks.map((chunk) => chunk.type)).toEqual([
				"text",
				"usage",
				"done",
			]);
			const textChunk = chunks.find(
				(chunk): chunk is Extract<ApiStreamChunk, { type: "text" }> =>
					chunk.type === "text",
			);
			const usageChunk = chunks.find(
				(chunk): chunk is Extract<ApiStreamChunk, { type: "usage" }> =>
					chunk.type === "usage",
			);
			expect(textChunk?.text).toBe("Hello");
			expect(usageChunk?.inputTokens).toBe(10);
			expect(usageChunk?.outputTokens).toBe(3);
		});

		it("uses full model IDs without changes", async () => {
			streamTextSpy.mockReturnValue({
				fullStream: makeStreamParts([{ type: "finish", usage: {} }]),
			});

			const handler = new OpenCodeHandler({
				providerId: "opencode",
				modelId: "openai/gpt-5.1-codex-max",
			});

			for await (const _chunk of handler.createMessage("System", [
				{ role: "user", content: "Hi" },
			])) {
				// noop
			}

			expect(opencodeSpy).toHaveBeenCalledWith("openai/gpt-5.1-codex-max");
		});
	});

	describe("SapAiCoreHandler", () => {
		it("uses a fallback model id when model is missing", () => {
			const handler = new SapAiCoreHandler({
				providerId: "sapaicore",
				modelId: "",
			});

			expect(handler.getModel().id).toBe("anthropic--claude-3.5-sonnet");
		});

		it("maps sap config to provider create options and streams text", async () => {
			streamTextSpy.mockReturnValue({
				fullStream: makeStreamParts([
					{ type: "text-delta", textDelta: "Hello" },
					{
						type: "finish",
						usage: { inputTokens: 10, outputTokens: 3 },
					},
				]),
			});

			const handler = new SapAiCoreHandler({
				providerId: "sapaicore",
				modelId: "gpt-4o",
				sap: {
					resourceGroup: "default",
					deploymentId: "dep-123",
					useOrchestrationMode: false,
					defaultSettings: {
						modelParams: { temperature: 0 },
					},
				},
			});

			const chunks: ApiStreamChunk[] = [];
			for await (const chunk of handler.createMessage("System", [
				{ role: "user", content: "Hi" },
			])) {
				chunks.push(chunk);
			}

			expect(sapAiProviderSpy).toHaveBeenCalledWith("gpt-4o");
			expect(lastCreateSapAiProviderOptions).toEqual({
				resourceGroup: "default",
				deploymentId: "dep-123",
				api: "foundation-models",
				defaultSettings: {
					modelParams: { temperature: 0 },
				},
			});
			expect(chunks.map((chunk) => chunk.type)).toEqual([
				"text",
				"usage",
				"done",
			]);
		});
	});
});
