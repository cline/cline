import type {
	GatewayProviderContext,
	GatewayProviderManifest,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	applyBedrockCachePoints,
	BEDROCK_ROUTING_METADATA,
	resolveBedrockCachePointRoute,
	shouldApplyBedrockCachePoint,
} from "./bedrock-cache-point";

function makeContext(options?: {
	metadata?: GatewayProviderManifest["metadata"];
	family?: string;
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
});

describe("applyBedrockCachePoints", () => {
	const cachePoint = { bedrock: { cachePoint: { type: "default" } } };

	it("marks the last two user messages", () => {
		const messages: Array<Record<string, unknown>> = [
			{ role: "user", content: [{ type: "text", text: "first" }] },
			{ role: "assistant", content: [{ type: "text", text: "answer" }] },
			{ role: "user", content: [{ type: "text", text: "second" }] },
			{ role: "assistant", content: [{ type: "text", text: "answer" }] },
			{ role: "user", content: [{ type: "text", text: "third" }] },
		];

		applyBedrockCachePoints(messages);

		expect(messages.map((message) => message.providerOptions)).toEqual([
			undefined,
			undefined,
			cachePoint,
			undefined,
			cachePoint,
		]);
	});

	it("marks tool results, so a turn's steps read the previous step's write", () => {
		const messages: Array<Record<string, unknown>> = [
			{ role: "user", content: [{ type: "text", text: "go" }] },
			{ role: "assistant", content: [{ type: "tool-call", toolCallId: "1" }] },
			{ role: "tool", content: [{ type: "tool-result", toolCallId: "1" }] },
			{ role: "assistant", content: [{ type: "tool-call", toolCallId: "2" }] },
			{ role: "tool", content: [{ type: "tool-result", toolCallId: "2" }] },
		];

		applyBedrockCachePoints(messages);

		expect(messages.map((message) => message.providerOptions)).toEqual([
			undefined,
			undefined,
			cachePoint,
			undefined,
			cachePoint,
		]);
	});

	it("preserves existing message provider options", () => {
		const messages: Array<Record<string, unknown>> = [
			{
				role: "user",
				content: [{ type: "text", text: "hello" }],
				providerOptions: { other: { keep: true } },
			},
		];

		applyBedrockCachePoints(messages);

		expect(messages[0].providerOptions).toEqual({
			other: { keep: true },
			bedrock: { cachePoint: { type: "default" } },
		});
	});

	it("is a no-op when there is no user message", () => {
		const messages: Array<Record<string, unknown>> = [
			{ role: "assistant", content: [{ type: "text", text: "answer" }] },
		];

		applyBedrockCachePoints(messages);

		expect(messages[0]).not.toHaveProperty("providerOptions");
	});
});
