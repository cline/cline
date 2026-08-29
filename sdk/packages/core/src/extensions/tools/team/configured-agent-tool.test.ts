import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionRuntime } from "../../../runtime/orchestration/session-runtime-orchestrator";
import {
	buildConfiguredAgentToolName,
	createConfiguredAgentTools,
} from "./configured-agent-tool";

function createTestTools() {
	return createConfiguredAgentTools({
		configProvider: {
			getRuntimeConfig: () => ({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
			}),
			getConnectionConfig: () => ({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
			}),
			updateConnectionDefaults: () => {},
		},
		agents: [
			{
				name: "code-reviewer",
				description: "Reviews code",
				systemPrompt: "You are a code reviewer.",
			},
		],
	});
}

describe("configured agent tools", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("builds stable subagent tool names", () => {
		expect(buildConfiguredAgentToolName("Code Reviewer")).toBe(
			"subagent_code_reviewer",
		);
		expect(buildConfiguredAgentToolName("___")).toBe("subagent_agent");
	});

	it("matches spawn_agent timeout and retry policy", () => {
		const [tool] = createTestTools();

		expect(tool?.name).toBe("subagent_code_reviewer");
		expect(tool?.timeoutMs).toBe(300000);
		expect(tool?.retryable).toBe(false);
	});

	it("shuts down its one-off delegated session after execution", async () => {
		vi.spyOn(SessionRuntime.prototype, "run").mockResolvedValue({
			text: "review complete",
			iterations: 1,
			finishReason: "completed",
			usage: { inputTokens: 1, outputTokens: 1 },
		} as never);
		const shutdown = vi
			.spyOn(SessionRuntime.prototype, "shutdown")
			.mockResolvedValue();
		const [tool] = createTestTools();

		await tool?.execute(
			{ prompt: "Review this change" },
			{ agentId: "parent", conversationId: "conversation", iteration: 1 },
		);

		expect(shutdown).toHaveBeenCalledTimes(1);
	});
});
