import { describe, expect, it } from "vitest";
import {
	buildConfiguredAgentToolName,
	createConfiguredAgentTools,
} from "./configured-agent-tool";

describe("configured agent tools", () => {
	it("builds stable subagent tool names", () => {
		expect(buildConfiguredAgentToolName("Code Reviewer")).toBe(
			"subagent_code_reviewer",
		);
		expect(buildConfiguredAgentToolName("___")).toBe("subagent_agent");
	});

	it("matches spawn_agent timeout and retry policy", () => {
		const [tool] = createConfiguredAgentTools({
			configProvider: {
				getRuntimeConfig: () => ({
					providerId: "bedrock",
					modelId: "claude-sonnet-4-6",
					providerConfig: {
						providerId: "bedrock",
						modelId: "claude-sonnet-4-6",
						connection: { region: "us-east-1" },
					},
				}),
				getConnectionConfig: () => ({
					providerId: "bedrock",
					modelId: "claude-sonnet-4-6",
					providerConfig: {
						providerId: "bedrock",
						modelId: "claude-sonnet-4-6",
						connection: { region: "us-east-1" },
					},
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

		expect(tool?.name).toBe("subagent_code_reviewer");
		expect(tool?.timeoutMs).toBe(300000);
		expect(tool?.retryable).toBe(false);
	});
});
