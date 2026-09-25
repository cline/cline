import type {
	GatewayProviderContext,
	GatewayProviderManifest,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	applyBedrockCachePointToLastCacheableMessage,
	BEDROCK_ROUTING_METADATA,
	resolveBedrockCachePointRoute,
	shouldApplyBedrockCachePoint,
} from "./bedrock-cache-point";

function makeContext(options?: {
	metadata?: GatewayProviderManifest["metadata"];
	family?: string;
	providerOptions?: Record<string, unknown>;
}): GatewayProviderContext {
	return {
		provider: {
			id: "bedrock",
			name: "AWS Bedrock",
			defaultModelId: "default-model",
			models: [],
			metadata: options?.metadata ?? BEDROCK_ROUTING_METADATA,
		},
		model: {
			id: "model-id",
			name: "Model",
			providerId: "bedrock",
			metadata: options?.family ? { family: options.family } : undefined,
		},
		config: {
			providerId: "bedrock",
			options: options?.providerOptions,
		},
	};
}

function makeRequest(modelId: string): GatewayStreamRequest {
	return {
		providerId: "bedrock",
		modelId,
		messages: [],
	};
}

describe("bedrock cache-point routing", () => {
	it("resolves the route for anthropic-compatible bedrock model ids", () => {
		const request = makeRequest("global.anthropic.claude-sonnet-4-6");
		expect(resolveBedrockCachePointRoute(request, makeContext())).toEqual({
			matcher: "anthropic-compatible",
		});
		expect(shouldApplyBedrockCachePoint(request, makeContext())).toBe(true);
	});

	it("does not resolve for non-anthropic bedrock models", () => {
		const request = makeRequest("minimax.minimax-m2.5");
		expect(
			resolveBedrockCachePointRoute(request, makeContext()),
		).toBeUndefined();
		expect(shouldApplyBedrockCachePoint(request, makeContext())).toBe(false);
	});

	it("does not resolve for anthropic-cache-control metadata", () => {
		const request = makeRequest("anthropic.claude-sonnet-4-6");
		const context = makeContext({
			metadata: {
				routing: {
					promptCache: {
						format: "anthropic-cache-control",
						routes: [{ matcher: "anthropic-compatible" }],
					},
				},
			},
		});
		expect(shouldApplyBedrockCachePoint(request, context)).toBe(false);
	});

	it("resolves through family metadata when the model id is an alias", () => {
		const request = makeRequest("my-claude-alias");
		expect(
			shouldApplyBedrockCachePoint(
				request,
				makeContext({ family: "claude-sonnet" }),
			),
		).toBe(true);
	});

	it("respects only an explicit prompt-cache opt-out", () => {
		const request = makeRequest("global.anthropic.claude-sonnet-4-6");

		expect(
			shouldApplyBedrockCachePoint(
				request,
				makeContext({ providerOptions: { usePromptCache: false } }),
			),
		).toBe(false);
		expect(
			shouldApplyBedrockCachePoint(
				request,
				makeContext({ providerOptions: { usePromptCache: true } }),
			),
		).toBe(true);
		expect(shouldApplyBedrockCachePoint(request, makeContext())).toBe(true);
	});
});

describe("applyBedrockCachePointToLastCacheableMessage", () => {
	it("attaches a message-level cachePoint marker to the last user message", () => {
		const messages: Array<Record<string, unknown>> = [
			{ role: "user", content: [{ type: "text", text: "first" }] },
			{ role: "assistant", content: [{ type: "text", text: "answer" }] },
			{ role: "user", content: [{ type: "text", text: "second" }] },
		];

		applyBedrockCachePointToLastCacheableMessage(messages);

		expect(messages[0]).not.toHaveProperty("providerOptions");
		expect(messages[1]).not.toHaveProperty("providerOptions");
		expect(messages[2].providerOptions).toEqual({
			bedrock: { cachePoint: { type: "default" } },
		});
	});

	it("preserves existing message provider options", () => {
		const messages: Array<Record<string, unknown>> = [
			{
				role: "user",
				content: [{ type: "text", text: "hello" }],
				providerOptions: { other: { keep: true } },
			},
		];

		applyBedrockCachePointToLastCacheableMessage(messages);

		expect(messages[0].providerOptions).toEqual({
			other: { keep: true },
			bedrock: { cachePoint: { type: "default" } },
		});
	});

	it("is a no-op when there is no user message", () => {
		const messages: Array<Record<string, unknown>> = [
			{ role: "assistant", content: [{ type: "text", text: "answer" }] },
		];

		applyBedrockCachePointToLastCacheableMessage(messages);

		expect(messages[0]).not.toHaveProperty("providerOptions");
	});

	it("attaches the marker to a tool-result continuation", () => {
		const messages: Array<Record<string, unknown>> = [
			{ role: "user", content: [{ type: "text", text: "start" }] },
			{
				role: "assistant",
				content: [{ type: "tool-call", toolCallId: "call-1" }],
			},
			{
				role: "tool",
				content: [{ type: "tool-result", toolCallId: "call-1" }],
			},
		];

		applyBedrockCachePointToLastCacheableMessage(messages);

		expect(messages[0]).not.toHaveProperty("providerOptions");
		expect(messages[1]).not.toHaveProperty("providerOptions");
		expect(messages[2].providerOptions).toEqual({
			bedrock: { cachePoint: { type: "default" } },
		});
	});

	it("advances the marker through two tool-result continuations", () => {
		const messages: Array<Record<string, unknown>> = [
			{ role: "user", content: [{ type: "text", text: "start" }] },
			{
				role: "assistant",
				content: [{ type: "tool-call", toolCallId: "call-1" }],
			},
			{
				role: "tool",
				content: [{ type: "tool-result", toolCallId: "call-1" }],
			},
			{
				role: "assistant",
				content: [{ type: "tool-call", toolCallId: "call-2" }],
			},
			{
				role: "tool",
				content: [{ type: "tool-result", toolCallId: "call-2" }],
			},
		];

		applyBedrockCachePointToLastCacheableMessage(messages);

		for (const message of messages.slice(0, -1)) {
			expect(message).not.toHaveProperty("providerOptions");
		}
		expect(messages.at(-1)?.providerOptions).toEqual({
			bedrock: { cachePoint: { type: "default" } },
		});
	});

	it("marks a tool message containing multiple tool results", () => {
		const messages: Array<Record<string, unknown>> = [
			{ role: "user", content: [{ type: "text", text: "start" }] },
			{
				role: "assistant",
				content: [
					{ type: "tool-call", toolCallId: "call-1" },
					{ type: "tool-call", toolCallId: "call-2" },
				],
			},
			{
				role: "tool",
				content: [
					{ type: "tool-result", toolCallId: "call-1" },
					{ type: "tool-result", toolCallId: "call-2" },
				],
			},
		];

		applyBedrockCachePointToLastCacheableMessage(messages);

		expect(messages[2].providerOptions).toEqual({
			bedrock: { cachePoint: { type: "default" } },
		});
	});

	it("prefers a new human user message after a tool continuation", () => {
		const messages: Array<Record<string, unknown>> = [
			{ role: "user", content: [{ type: "text", text: "start" }] },
			{
				role: "tool",
				content: [{ type: "tool-result", toolCallId: "call-1" }],
			},
			{ role: "user", content: [{ type: "text", text: "continue" }] },
		];

		applyBedrockCachePointToLastCacheableMessage(messages);

		expect(messages[0]).not.toHaveProperty("providerOptions");
		expect(messages[1]).not.toHaveProperty("providerOptions");
		expect(messages[2].providerOptions).toEqual({
			bedrock: { cachePoint: { type: "default" } },
		});
	});

	it("places the marker after tool results split from the same Cline user message", () => {
		const messages: Array<Record<string, unknown>> = [
			{ role: "user", content: [{ type: "text", text: "context" }] },
			{
				role: "tool",
				content: [{ type: "tool-result", toolCallId: "call-1" }],
			},
		];

		applyBedrockCachePointToLastCacheableMessage(messages);

		expect(messages[0]).not.toHaveProperty("providerOptions");
		expect(messages[1].providerOptions).toEqual({
			bedrock: { cachePoint: { type: "default" } },
		});
	});

	it("skips tool messages that contain no tool results", () => {
		const messages: Array<Record<string, unknown>> = [
			{ role: "user", content: [{ type: "text", text: "start" }] },
			{
				role: "tool",
				content: [{ type: "tool-result", toolCallId: "call-1" }],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-approval-response",
						approvalId: "approval-1",
						approved: true,
					},
				],
			},
		];

		applyBedrockCachePointToLastCacheableMessage(messages);

		expect(messages[1].providerOptions).toEqual({
			bedrock: { cachePoint: { type: "default" } },
		});
		expect(messages[2]).not.toHaveProperty("providerOptions");
	});

	it("is a no-op for assistant-only and empty message lists", () => {
		const assistantOnly: Array<Record<string, unknown>> = [
			{ role: "assistant", content: [{ type: "text", text: "answer" }] },
		];
		const empty: Array<Record<string, unknown>> = [];

		applyBedrockCachePointToLastCacheableMessage(assistantOnly);
		applyBedrockCachePointToLastCacheableMessage(empty);

		expect(assistantOnly[0]).not.toHaveProperty("providerOptions");
		expect(empty).toEqual([]);
	});

	it("preserves other namespaces and existing bedrock options", () => {
		const messages: Array<Record<string, unknown>> = [
			{
				role: "user",
				content: [{ type: "text", text: "hello" }],
				providerOptions: {
					other: { keep: true },
					bedrock: { someKey: 1 },
				},
			},
		];

		applyBedrockCachePointToLastCacheableMessage(messages);

		expect(messages[0].providerOptions).toEqual({
			other: { keep: true },
			bedrock: { someKey: 1, cachePoint: { type: "default" } },
		});
	});

	it("adds exactly one marker per call", () => {
		const messages: Array<Record<string, unknown>> = [
			{ role: "user", content: [{ type: "text", text: "start" }] },
			{
				role: "tool",
				content: [{ type: "tool-result", toolCallId: "call-1" }],
			},
		];

		applyBedrockCachePointToLastCacheableMessage(messages);

		const markedMessages = messages.filter((message) => {
			const providerOptions = message.providerOptions as
				| Record<string, unknown>
				| undefined;
			const bedrock = providerOptions?.bedrock as
				| Record<string, unknown>
				| undefined;
			return bedrock?.cachePoint !== undefined;
		});
		expect(markedMessages).toHaveLength(1);
	});

	it("falls back to the last user message when tool messages are disabled", () => {
		const messages: Array<Record<string, unknown>> = [
			{ role: "user", content: [{ type: "text", text: "start" }] },
			{
				role: "assistant",
				content: [{ type: "tool-call", toolCallId: "call-1" }],
			},
			{
				role: "tool",
				content: [{ type: "tool-result", toolCallId: "call-1" }],
			},
		];

		applyBedrockCachePointToLastCacheableMessage(messages, {
			includeToolMessages: false,
		});

		expect(messages[0].providerOptions).toEqual({
			bedrock: { cachePoint: { type: "default" } },
		});
		expect(messages[1]).not.toHaveProperty("providerOptions");
		expect(messages[2]).not.toHaveProperty("providerOptions");
	});
});
