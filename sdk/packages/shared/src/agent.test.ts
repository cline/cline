import { describe, expect, it } from "vitest";
import { isAgentRuntimeEvent } from "./agent";

const snapshot = {
	agentId: "agent-1",
	runId: "run-1",
	status: "running",
	iteration: 1,
	messages: [],
	pendingToolCalls: [],
	usage: {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	},
};

describe("isAgentRuntimeEvent", () => {
	it("accepts a serialized reasoning event", () => {
		expect(
			isAgentRuntimeEvent({
				type: "assistant-reasoning-delta",
				snapshot,
				iteration: 1,
				text: "token",
				accumulatedText: "reasoning token",
			}),
		).toBe(true);
	});

	it("rejects missing or malformed event payload fields", () => {
		expect(
			isAgentRuntimeEvent({
				type: "assistant-reasoning-delta",
				snapshot,
				iteration: 1,
				text: "token",
			}),
		).toBe(false);
		expect(
			isAgentRuntimeEvent({
				type: "message-added",
				snapshot,
				message: { role: "user", content: [] },
			}),
		).toBe(false);
		expect(
			isAgentRuntimeEvent({
				type: "unknown-event",
				snapshot,
			}),
		).toBe(false);
	});
});
