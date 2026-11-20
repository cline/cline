import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type { AgentEvent } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import { forwardAgentEvent } from "./session-updates";

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

	it("forwards usage events as ACP usage_update notifications", () => {
		const sessionUpdate = vi.fn().mockResolvedValue(undefined);
		const connection = { sessionUpdate } as unknown as AgentSideConnection;

		forwardAgentEvent(
			connection,
			"session-1",
			{
				type: "usage",
				inputTokens: 120,
				outputTokens: 30,
				cacheReadTokens: 80,
				totalInputTokens: 200,
				totalOutputTokens: 30,
				totalCost: 0.0042,
			} as AgentEvent,
			200_000,
		);

		expect(sessionUpdate).toHaveBeenCalledWith({
			sessionId: "session-1",
			update: {
				sessionUpdate: "usage_update",
				used: 200,
				size: 200_000,
				cost: { amount: 0.0042, currency: "USD" },
			},
		});
	});

	it("skips usage_update when the context window size is unknown or zero", () => {
		const sessionUpdate = vi.fn().mockResolvedValue(undefined);
		const connection = { sessionUpdate } as unknown as AgentSideConnection;
		const event = {
			type: "usage",
			inputTokens: 120,
			outputTokens: 30,
			totalInputTokens: 120,
			totalOutputTokens: 30,
			totalCost: 0.0042,
		} as AgentEvent;

		forwardAgentEvent(connection, "session-1", event);
		forwardAgentEvent(connection, "session-1", event, 0);

		expect(sessionUpdate).not.toHaveBeenCalled();
	});

	it("prefers cumulativeCost over per-turn event cost when provided", () => {
		const sessionUpdate = vi.fn().mockResolvedValue(undefined);
		const connection = { sessionUpdate } as unknown as AgentSideConnection;

		forwardAgentEvent(
			connection,
			"session-1",
			{
				type: "usage",
				inputTokens: 50,
				outputTokens: 10,
				totalCost: 0.004,
			} as AgentEvent,
			200_000,
			0.0095,
		);

		expect(sessionUpdate).toHaveBeenCalledWith({
			sessionId: "session-1",
			update: {
				sessionUpdate: "usage_update",
				used: 50,
				size: 200_000,
				cost: { amount: 0.0095, currency: "USD" },
			},
		});
	});
});
