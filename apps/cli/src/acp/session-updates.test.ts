import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type { AgentEvent } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import {
	forwardAgentEvent,
	promptUsageFrom,
	usageUpdateFor,
} from "./session-updates";

describe("forwardAgentEvent", () => {
	it("forwards generated images as ACP agent message chunks", () => {
		const sessionUpdate = vi.fn().mockResolvedValue(undefined);
		const connection = { sessionUpdate } as unknown as AgentSideConnection;

		forwardAgentEvent(connection, "session-1", {
			type: "content_end",
			contentType: "media",
			media: {
				id: "generated-1",
				modality: "image",
				mediaType: "image/png",
				source: { type: "base64", data: "aGVsbG8=" },
			},
		} as AgentEvent);

		expect(sessionUpdate).toHaveBeenCalledWith({
			sessionId: "session-1",
			update: {
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "image",
					data: "aGVsbG8=",
					mimeType: "image/png",
				},
			},
		});
	});
});

describe("usageUpdateFor", () => {
	const usage = (
		extra: Partial<AgentEvent & { type: "usage" }> = {},
	): AgentEvent & { type: "usage" } =>
		({
			type: "usage",
			inputTokens: 1200,
			outputTokens: 300,
			cacheReadTokens: 40_000,
			cacheWriteTokens: 500,
			totalInputTokens: 5000,
			totalOutputTokens: 900,
			totalCost: 0.0421,
			...extra,
		}) as AgentEvent & { type: "usage" };

	it("reports the call's whole prompt and reply against the model's context window, with the session cost", () => {
		expect(usageUpdateFor(usage(), 200_000)).toEqual({
			sessionUpdate: "usage_update",
			used: 1200 + 300 + 40_000 + 500,
			size: 200_000,
			cost: { amount: 0.0421, currency: "USD" },
		});
	});

	it("leaves out the cost when the provider reported none", () => {
		expect(usageUpdateFor(usage({ totalCost: undefined }), 128_000)).toEqual({
			sessionUpdate: "usage_update",
			used: 41_000 + 1000,
			size: 128_000,
		});
	});

	it("sends nothing without a known context window, since size is required", () => {
		expect(usageUpdateFor(usage(), undefined)).toBeNull();
		expect(usageUpdateFor(usage(), 0)).toBeNull();
	});

	it("does not report a subagent's context as the session's", () => {
		expect(
			usageUpdateFor(usage({ parentAgentId: "root" }), 200_000),
		).toBeNull();
	});
});

describe("promptUsageFrom", () => {
	it("turns a turn's usage into PromptResponse.usage", () => {
		expect(
			promptUsageFrom({
				inputTokens: 100,
				outputTokens: 20,
				cacheReadTokens: 3000,
				cacheWriteTokens: 50,
				totalCost: 0.01,
			} as never),
		).toEqual({
			inputTokens: 100,
			outputTokens: 20,
			cachedReadTokens: 3000,
			cachedWriteTokens: 50,
			totalTokens: 3170,
		});
		expect(promptUsageFrom({ inputTokens: 5, outputTokens: 1 })).toEqual({
			inputTokens: 5,
			outputTokens: 1,
			totalTokens: 6,
		});
		expect(promptUsageFrom(undefined)).toBeUndefined();
	});
});
