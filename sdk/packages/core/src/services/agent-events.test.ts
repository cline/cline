import type { AgentEvent } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { CoreSessionConfig } from "../types/config";
import type { ActiveSession } from "../types/session";
import {
	type AgentEventContext,
	handleAgentEvent,
	legacyTokenUsageFromUsageEvent,
} from "./agent-events";
import { TelemetryService } from "./telemetry/TelemetryService";
import { createInitialAccumulatedUsage } from "./usage";

type UsageEvent = Extract<AgentEvent, { type: "usage" }>;

function usageEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
	return {
		type: "usage",
		inputTokens: 0,
		outputTokens: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
		...overrides,
	};
}

function createTelemetryHarness() {
	const adapter = {
		name: "test",
		emit: vi.fn(),
		emitRequired: vi.fn(),
		recordCounter: vi.fn(),
		recordHistogram: vi.fn(),
		recordGauge: vi.fn(),
		isEnabled: vi.fn(() => true),
		flush: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
	};
	const telemetry = new TelemetryService({
		adapters: [adapter],
		distinctId: "distinct-test",
	});
	return { adapter, telemetry };
}

function createContext(telemetry: TelemetryService): AgentEventContext {
	const config = {
		providerId: "cline",
		modelId: "anthropic/claude-haiku-4.5",
		mode: "act",
		telemetry,
	} as unknown as CoreSessionConfig;
	const liveSession = {
		sessionId: "sess-tokens",
		config,
		runtime: {},
		agent: {
			getMessages: () => [],
		},
		turnUsageBaseline: createInitialAccumulatedUsage(),
	} as unknown as ActiveSession;
	return {
		sessionId: "sess-tokens",
		config,
		liveSession,
		usageBySession: new Map(),
		aggregateUsageBySession: new Map(),
		persistMessages: vi.fn(),
		emit: vi.fn(),
	};
}

function tokenUsageEmits(adapter: { emit: ReturnType<typeof vi.fn> }) {
	return adapter.emit.mock.calls.filter(([event]) => event === "task.tokens");
}

describe("legacyTokenUsageFromUsageEvent", () => {
	it("subtracts cache reads/writes from the cache-inclusive inputTokens", () => {
		// SDK usage events report inputTokens as the full request input
		// (cache reads/writes included). The legacy task.tokens contract
		// wants disjoint buckets.
		expect(
			legacyTokenUsageFromUsageEvent(
				usageEvent({
					inputTokens: 11067,
					outputTokens: 57,
					cacheReadTokens: 6819,
					cacheWriteTokens: 2000,
					cost: 0.0052149,
				}),
			),
		).toEqual({
			tokensIn: 2248,
			tokensOut: 57,
			cacheReadTokens: 6819,
			cacheWriteTokens: 2000,
			totalCost: 0.0052149,
		});
	});

	it("passes uncached-only usage through unchanged with zeroed cache buckets", () => {
		expect(
			legacyTokenUsageFromUsageEvent(
				usageEvent({ inputTokens: 6357, outputTokens: 209, cost: 0.007402 }),
			),
		).toEqual({
			tokensIn: 6357,
			tokensOut: 209,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0.007402,
		});
	});

	it("clamps at zero for providers whose inputTokens is already uncached-only", () => {
		// ApiHandler-backed providers (legacy handler chunks) report
		// inputTokens exclusive of cache tokens already.
		expect(
			legacyTokenUsageFromUsageEvent(
				usageEvent({
					inputTokens: 100,
					outputTokens: 5,
					cacheReadTokens: 9000,
				}),
			).tokensIn,
		).toBe(0);
	});
});

describe("handleAgentEvent task.tokens emission", () => {
	it("emits one task.tokens per usage event with per-request disjoint buckets", () => {
		const { adapter, telemetry } = createTelemetryHarness();
		const ctx = createContext(telemetry);

		handleAgentEvent(
			ctx,
			usageEvent({
				inputTokens: 6822,
				outputTokens: 125,
				cost: 0.007447,
				totalInputTokens: 6822,
				totalOutputTokens: 125,
				totalCost: 0.007447,
			}),
			{ agentId: "agent-root", isPrimaryAgentEvent: true },
		);
		handleAgentEvent(
			ctx,
			usageEvent({
				inputTokens: 11067,
				outputTokens: 57,
				cacheReadTokens: 6819,
				cost: 0.0052149,
				// Running totals ride along on the event but must never be
				// what task.tokens reports.
				totalInputTokens: 17889,
				totalOutputTokens: 182,
				totalCacheReadTokens: 6819,
				totalCost: 0.0126619,
			}),
			{ agentId: "agent-root", isPrimaryAgentEvent: true },
		);

		const emits = tokenUsageEmits(adapter);
		expect(emits).toHaveLength(2);
		expect(emits[0][1]).toMatchObject({
			ulid: "sess-tokens",
			tokensIn: 6822,
			tokensOut: 125,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0.007447,
			provider: "cline",
			model: "anthropic/claude-haiku-4.5",
		});
		expect(emits[1][1]).toMatchObject({
			tokensIn: 4248,
			tokensOut: 57,
			cacheReadTokens: 6819,
			cacheWriteTokens: 0,
			totalCost: 0.0052149,
		});
	});

	it("does not emit task.tokens for non-primary (teammate/subagent) usage", () => {
		const { adapter, telemetry } = createTelemetryHarness();
		const ctx = createContext(telemetry);

		handleAgentEvent(
			ctx,
			usageEvent({ inputTokens: 500, outputTokens: 20, cost: 0.001 }),
			{ agentId: "agent-teammate", isPrimaryAgentEvent: false },
		);

		expect(tokenUsageEmits(adapter)).toHaveLength(0);
	});
});
