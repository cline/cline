import { describe, expect, it } from "vitest";
import {
	buildDelegatedAgentConfig,
	createDelegatedAgentConfigProvider,
} from "./delegated-agent";

describe("buildDelegatedAgentConfig", () => {
	it("versions complete connection snapshots for active delegated refreshes", () => {
		const configProvider = createDelegatedAgentConfigProvider({
			providerId: "lmstudio",
			modelId: "local-model",
			apiKey: "old-key",
			baseUrl: "http://custom-endpoint",
		});
		const initial = configProvider.getConnectionSnapshot();

		configProvider.updateConnectionDefaults({
			apiKey: "new-key",
			baseUrl: undefined,
		});

		expect(configProvider.getConnectionSnapshot()).toEqual({
			version: initial.version + 1,
			config: expect.objectContaining({
				providerId: "lmstudio",
				modelId: "local-model",
				apiKey: "new-key",
				baseUrl: undefined,
			}),
		});
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
