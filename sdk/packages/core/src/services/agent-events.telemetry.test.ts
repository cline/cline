import type { AgentEvent, ITelemetryService } from "@cline/shared";
import { describe, expect, test, vi } from "vitest";
import { type AgentEventContext, handleAgentEvent } from "./agent-events";
import { CORE_TELEMETRY_EVENTS } from "./telemetry/core-events";
import { createInitialAccumulatedUsage } from "./usage";

describe("handleAgentEvent telemetry", () => {
	test("passes the configured provider through the production usage-event path", () => {
		const capture = vi.fn();
		const telemetry = { capture } as unknown as ITelemetryService;
		const baseline = createInitialAccumulatedUsage();
		const context = {
			sessionId: "session-1",
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet",
				mode: "act",
				telemetry,
			},
			liveSession: {
				runtime: { teamRuntime: undefined },
				turnUsageBaseline: baseline,
				turnAggregateUsageBaseline: baseline,
			},
			usageBySession: new Map(),
			aggregateUsageBySession: new Map(),
			persistMessages: vi.fn(),
			emit: vi.fn(),
		} as unknown as AgentEventContext;
		const event = {
			type: "usage",
			inputTokens: 120,
			outputTokens: 80,
			cacheWriteTokens: 10,
			cacheReadTokens: 20,
			cost: 0.01,
		} as AgentEvent;

		handleAgentEvent(context, event);

		expect(capture).toHaveBeenCalledWith({
			event: CORE_TELEMETRY_EVENTS.TASK.TOKEN_USAGE,
			properties: expect.objectContaining({
				ulid: "session-1",
				provider: "anthropic",
				model: "claude-sonnet",
			}),
		});
	});
});
