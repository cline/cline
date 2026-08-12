import type {
	ApiHandler,
	ApiStreamChunk,
	HandlerModelInfo,
	Message,
} from "@cline/llms";
import type {
	AgentEvent,
	AgentModelRequest,
	AgentRuntimeStateSnapshot,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { RuntimeEventAdapter } from "../runtime/orchestration/runtime-event-adapter";
import type { CoreSessionConfig } from "../types/config";
import type { ActiveSession } from "../types/session";
import {
	type AgentEventContext,
	handleAgentEvent,
	legacyTokenUsageFromUsageEvent,
} from "./agent-events";
import { createAgentModelFromApiHandler } from "./llms/apihandler-agent-model-adapter";
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

	it("clamps at zero as a defensive guard against out-of-contract usage", () => {
		// Every producer is required to report cache-INCLUSIVE inputTokens
		// (see AgentTokenUsage in @cline/shared; classic disjoint ApiHandler
		// chunks are normalized in apihandler-agent-model-adapter.ts). An
		// event violating that invariant must not produce a negative bucket,
		// but the clamp is a last-resort guard, not a supported shape — the
		// fix for data like this belongs at the producer boundary.
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

	it("round-trips a registered ApiHandler's disjoint usage chunk into task.tokens", async () => {
		// Boundary test across the whole producer-to-telemetry path: a classic
		// disjoint ApiStreamUsageChunk (inputTokens = uncached input only) is
		// normalized to the canonical cache-inclusive AgentUsage by
		// createAgentModelFromApiHandler, accumulated into the run snapshot the
		// way AgentRuntime.updateUsage does, re-derived into a per-request
		// delta by RuntimeEventAdapter, and finally translated back to legacy
		// disjoint buckets for task.tokens — which must report the original
		// chunk values, not a clamped zero.
		const handler: ApiHandler = {
			getMessages: () => [],
			getModel: (): HandlerModelInfo => ({ id: "m", info: { id: "m" } }),
			async *createMessage(
				_system: string,
				_messages: Message[],
			): AsyncGenerator<ApiStreamChunk> {
				yield {
					type: "usage",
					inputTokens: 100,
					outputTokens: 5,
					cacheReadTokens: 9000,
					id: "req-1",
				};
			},
		};
		const request: AgentModelRequest = {
			systemPrompt: "sys",
			messages: [
				{
					id: "1",
					role: "user",
					content: [{ type: "text", text: "hi" }],
					createdAt: 0,
				},
			],
			tools: [],
		};
		const model = createAgentModelFromApiHandler(handler);
		const modelEvents = [];
		for await (const event of await model.stream(request)) {
			modelEvents.push(event);
		}
		const usage = modelEvents.find((event) => event.type === "usage");
		if (usage?.type !== "usage") throw new Error("no usage event");

		// Accumulate into the run snapshot exactly like AgentRuntime.updateUsage
		// (zero-initialized state plus `?? 0` defaults; for the first request
		// the snapshot equals the event).
		const runtimeAdapter = new RuntimeEventAdapter();
		const agentEvents = runtimeAdapter.translate({
			type: "usage-updated",
			snapshot: {} as AgentRuntimeStateSnapshot,
			usage: {
				inputTokens: usage.usage.inputTokens ?? 0,
				outputTokens: usage.usage.outputTokens ?? 0,
				cacheReadTokens: usage.usage.cacheReadTokens ?? 0,
				cacheWriteTokens: usage.usage.cacheWriteTokens ?? 0,
				reasoningTokenCount: usage.usage.reasoningTokenCount ?? 0,
				totalCost: usage.usage.totalCost ?? 0,
			},
		});

		const { adapter, telemetry } = createTelemetryHarness();
		const ctx = createContext(telemetry);
		for (const agentEvent of agentEvents) {
			handleAgentEvent(ctx, agentEvent, {
				agentId: "agent-root",
				isPrimaryAgentEvent: true,
			});
		}

		const emits = tokenUsageEmits(adapter);
		expect(emits).toHaveLength(1);
		expect(emits[0][1]).toMatchObject({
			tokensIn: 100,
			tokensOut: 5,
			cacheReadTokens: 9000,
			cacheWriteTokens: 0,
		});
	});
});
