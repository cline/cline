import { describe, expect, it } from "vitest";
import {
	buildDelegatedAgentConfig,
	createDelegatedAgentConfigProvider,
} from "./delegated-agent";

describe("buildDelegatedAgentConfig", () => {
	it.each([
		"subagent",
		"teammate",
	] as const)("inherits service tier for %s independently of reasoning", (kind) => {
		const configProvider = createDelegatedAgentConfigProvider({
			providerId: "openai-codex",
			modelId: "gpt-6-astra",
			serviceTier: "priority",
			thinking: false,
		});
		const build = () =>
			buildDelegatedAgentConfig({
				kind,
				prompt: "review",
				tools: [],
				configProvider,
			});
		expect(build()).toMatchObject({ serviceTier: "priority", thinking: false });
		configProvider.updateConnectionDefaults({ reasoningEffort: "high" });
		expect(build()).toMatchObject({
			serviceTier: "priority",
			reasoningEffort: "high",
		});
		configProvider.updateConnectionDefaults({ serviceTier: undefined });
		expect(build().serviceTier).toBeUndefined();
		expect(build().reasoningEffort).toBe("high");
	});
	it("inherits the parent distinctId and sessionId for telemetry grouping", () => {
		const configProvider = createDelegatedAgentConfigProvider({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-5",
			distinctId: "user-123",
			sessionId: "sess-parent",
		});

		const config = buildDelegatedAgentConfig({
			kind: "subagent",
			prompt: "review the diff",
			tools: [],
			configProvider,
			parentAgentId: "agent-lead",
		});

		expect(config.distinctId).toBe("user-123");
		expect(config.sessionId).toBe("sess-parent");
		expect(config.parentAgentId).toBe("agent-lead");
	});

	it("leaves identity fields undefined when the parent has none", () => {
		const configProvider = createDelegatedAgentConfigProvider({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-5",
		});

		const config = buildDelegatedAgentConfig({
			kind: "subagent",
			prompt: "review the diff",
			tools: [],
			configProvider,
		});

		expect(config.distinctId).toBeUndefined();
		expect(config.sessionId).toBeUndefined();
	});
});
