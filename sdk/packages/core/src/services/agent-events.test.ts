import type { ITelemetryService } from "@cline/shared";
import { describe, expect, test, vi } from "vitest";
import { type AgentEventContext, handleAgentEvent } from "./agent-events";
import { createInitialAccumulatedUsage } from "./usage";

function createTelemetryStub() {
	const capture = vi.fn();
	const telemetry = {
		capture,
		captureRequired: vi.fn(),
		setDistinctId: vi.fn(),
		setMetadata: vi.fn(),
		updateMetadata: vi.fn(),
		setCommonProperties: vi.fn(),
		updateCommonProperties: vi.fn(),
		isEnabled: vi.fn(() => true),
		recordCounter: vi.fn(),
		recordHistogram: vi.fn(),
		recordGauge: vi.fn(),
		flush: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
	} satisfies ITelemetryService;
	return { telemetry, capture };
}

function createContext(telemetry: ITelemetryService): AgentEventContext {
	return {
		sessionId: "task-1",
		config: {
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
			mode: "act",
			telemetry,
		} as AgentEventContext["config"],
		liveSession: undefined,
		usageBySession: new Map(),
		aggregateUsageBySession: new Map(),
		persistMessages: vi.fn(),
		emit: vi.fn(),
	};
}

function captureEvents(capture: ReturnType<typeof vi.fn>) {
	return capture.mock.calls.map(
		([arg]) => arg as { event: string; properties?: Record<string, unknown> },
	);
}

describe("handleAgentEvent telemetry compatibility", () => {
	test("emits task.tool_used with provider, model, and known autoApproved state", () => {
		const stub = createTelemetryStub();
		const ctx = createContext(stub.telemetry);

		handleAgentEvent(ctx, {
			type: "content_end",
			contentType: "tool",
			toolName: "read_files",
			toolCallId: "call-1",
			autoApproved: true,
		});

		expect(captureEvents(stub.capture)).toContainEqual({
			event: "task.tool_used",
			properties: expect.objectContaining({
				ulid: "task-1",
				tool: "read_files",
				modelId: "anthropic/claude-sonnet-4.6",
				provider: "cline",
				autoApproved: true,
				success: true,
			}),
		});
	});

	test("emits task.tokens with provider and model attribution", () => {
		const stub = createTelemetryStub();
		const ctx = createContext(stub.telemetry);
		ctx.liveSession = {
			runtime: {},
			turnUsageBaseline: createInitialAccumulatedUsage(),
			turnAggregateUsageBaseline: createInitialAccumulatedUsage(),
			turnPrimaryUsage: createInitialAccumulatedUsage(),
		} as AgentEventContext["liveSession"];

		handleAgentEvent(ctx, {
			type: "usage",
			inputTokens: 100,
			outputTokens: 25,
			cacheReadTokens: 10,
			cacheWriteTokens: 0,
			cost: 0.01,
			totalInputTokens: 100,
			totalOutputTokens: 25,
			totalCacheReadTokens: 10,
			totalCacheWriteTokens: 0,
			totalCost: 0.01,
		});

		expect(captureEvents(stub.capture)).toContainEqual({
			event: "task.tokens",
			properties: expect.objectContaining({
				ulid: "task-1",
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				tokensIn: 100,
				tokensOut: 25,
				cacheReadTokens: 10,
				cacheWriteTokens: 0,
				totalCost: 0.01,
			}),
		});
	});
});
