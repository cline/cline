/**
 * Unit tests for `createAgentRuntimeConfig` and its small pure
 * helpers (`buildModelOptions`, `buildMessageModelInfo`,
 * `resolveToolExecution`).
 *
 */

import type {
	AgentConfig,
	AgentModel,
	AgentModelEvent,
	AgentTool,
	ITelemetryService,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	buildMessageModelInfo,
	buildModelOptions,
	createAgentRuntimeConfig,
	resolveToolExecution,
} from "./agent-runtime-config-builder";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		providerId: "anthropic",
		modelId: "claude-3-5-sonnet",
		systemPrompt: "You are a helpful assistant.",
		tools: [],
		...overrides,
	};
}

const nullModel: AgentModel = {
	async stream() {
		return (async function* (): AsyncIterable<AgentModelEvent> {
			yield { type: "finish", reason: "stop" };
		})();
	},
};

// ---------------------------------------------------------------------------
// buildModelOptions
// ---------------------------------------------------------------------------

describe("buildModelOptions", () => {
	it("returns undefined when no reasoning/budget fields are set", () => {
		expect(buildModelOptions(makeAgentConfig())).toBeUndefined();
	});

	it("collects all provided fields", () => {
		const config = makeAgentConfig({
			thinking: true,
			reasoningEffort: "high",
			thinkingBudgetTokens: 1024,
			maxTokensPerTurn: 4096,
			apiTimeoutMs: 60_000,
		});
		expect(buildModelOptions(config)).toEqual({
			thinking: true,
			reasoningEffort: "high",
			thinkingBudgetTokens: 1024,
			maxTokensPerTurn: 4096,
			apiTimeoutMs: 60_000,
		});
	});

	it("omits undefined fields", () => {
		const config = makeAgentConfig({ thinking: true });
		expect(buildModelOptions(config)).toEqual({ thinking: true });
	});
});

// ---------------------------------------------------------------------------
// buildMessageModelInfo
// ---------------------------------------------------------------------------

describe("buildMessageModelInfo", () => {
	it("builds { id, provider, family } from AgentConfig", () => {
		const config = makeAgentConfig({
			providerId: "openai",
			modelId: "gpt-4o",
			providerConfig: { family: "gpt-4" },
		});
		expect(buildMessageModelInfo(config)).toEqual({
			id: "gpt-4o",
			provider: "openai",
			family: "gpt-4",
		});
	});

	it("omits family when not present in providerConfig", () => {
		const config = makeAgentConfig();
		expect(buildMessageModelInfo(config)).toEqual({
			id: "claude-3-5-sonnet",
			provider: "anthropic",
			family: undefined,
		});
	});
});

// ---------------------------------------------------------------------------
// resolveToolExecution
// ---------------------------------------------------------------------------

describe("resolveToolExecution", () => {
	it("returns undefined when unset", () => {
		expect(resolveToolExecution(undefined)).toBeUndefined();
	});

	it("returns 'sequential' for 1", () => {
		expect(resolveToolExecution(1)).toBe("sequential");
	});

	it("returns 'parallel' for >= 2", () => {
		expect(resolveToolExecution(2)).toBe("parallel");
		expect(resolveToolExecution(8)).toBe("parallel");
	});
});

// ---------------------------------------------------------------------------
// createAgentRuntimeConfig
// ---------------------------------------------------------------------------

describe("createAgentRuntimeConfig", () => {
	it("produces a config with the PLAN §3.2.1 field mapping", () => {
		const agentConfig = makeAgentConfig({
			systemPrompt: "sp",
			providerId: "openai",
			modelId: "gpt-4o",
			providerConfig: { family: "gpt-4" },
			thinking: true,
			reasoningEffort: "high",
			maxIterations: 7,
			maxParallelToolCalls: 4,
			completionPolicy: { requireCompletionTool: true },
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval: async () => ({ approved: true }),
			consumePendingUserMessage: () => "steer",
		});
		const tools: AgentTool[] = [
			{
				name: "echo",
				description: "e",
				inputSchema: { type: "object" },
				execute: async () => "x",
			},
		];
		const runtimeConfig = createAgentRuntimeConfig({
			agentConfig,
			sessionId: "session_abc",
			agentId: "agent_abc",
			conversationId: "conversation_abc",
			agentRole: "lead",
			model: nullModel,
			tools,
		});
		expect(runtimeConfig.sessionId).toBe("session_abc");
		expect(runtimeConfig.agentId).toBe("agent_abc");
		expect(runtimeConfig.conversationId).toBe("conversation_abc");
		expect(runtimeConfig.agentRole).toBe("lead");
		expect(runtimeConfig.systemPrompt).toBe("sp");
		expect(runtimeConfig.model).toBe(nullModel);
		expect(runtimeConfig.messageModelInfo).toEqual({
			id: "gpt-4o",
			provider: "openai",
			family: "gpt-4",
		});
		expect(runtimeConfig.modelOptions).toEqual({
			thinking: true,
			reasoningEffort: "high",
		});
		expect(runtimeConfig.tools).toBe(tools);
		expect(runtimeConfig.maxIterations).toBe(7);
		expect(runtimeConfig.toolExecution).toBe("parallel");
		expect(runtimeConfig.completionPolicy).toEqual({
			requireCompletionTool: true,
		});
		expect(runtimeConfig.toolPolicies).toEqual({
			"*": { autoApprove: false },
		});
		expect(runtimeConfig.requestToolApproval).toBe(
			agentConfig.requestToolApproval,
		);
		expect(runtimeConfig.consumePendingUserMessage).toBe(
			agentConfig.consumePendingUserMessage,
		);
	});

	it("uses the override systemPrompt when provided", () => {
		const runtimeConfig = createAgentRuntimeConfig({
			agentConfig: makeAgentConfig({ systemPrompt: "default" }),
			agentId: "a",
			model: nullModel,
			systemPrompt: "override",
		});
		expect(runtimeConfig.systemPrompt).toBe("override");
	});

	it("populates hooks when provided", () => {
		const beforeRun = vi.fn();
		const runtimeConfig = createAgentRuntimeConfig({
			agentConfig: makeAgentConfig(),
			agentId: "a",
			model: nullModel,
			hooks: { beforeRun },
		});
		expect(runtimeConfig.hooks?.beforeRun).toBe(beforeRun);
	});

	it("omits hooks when none are provided", () => {
		const runtimeConfig = createAgentRuntimeConfig({
			agentConfig: makeAgentConfig(),
			agentId: "a",
			model: nullModel,
		});
		expect(runtimeConfig.hooks).toBeUndefined();
	});

	it("passes through plugins/initialMessages/logger/telemetry", () => {
		const logger = {
			log: vi.fn(),
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		};
		const telemetryCapture = vi.fn();
		const telemetry = {
			capture: telemetryCapture,
			captureRequired: vi.fn(),
			setDistinctId: vi.fn(),
			setMetadata: vi.fn(),
			updateMetadata: vi.fn(),
			setCommonProperties: vi.fn(),
			updateCommonProperties: vi.fn(),
			isEnabled: () => true,
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			flush: vi.fn(async () => undefined),
			dispose: vi.fn(async () => undefined),
		} as unknown as ITelemetryService;
		const runtimeConfig = createAgentRuntimeConfig({
			agentConfig: makeAgentConfig(),
			agentId: "a",
			model: nullModel,
			logger,
			telemetry,
			plugins: [{ name: "p1" }],
			initialMessages: [
				{
					id: "m1",
					role: "user",
					content: [{ type: "text", text: "hi" }],
					createdAt: 1,
				},
			],
		});
		expect(runtimeConfig.logger).toBe(logger);
		expect(runtimeConfig.telemetry).toBe(telemetry);
		expect(runtimeConfig.plugins).toHaveLength(1);
		expect(runtimeConfig.initialMessages).toHaveLength(1);
	});
});
