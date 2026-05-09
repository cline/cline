import { describe, expect, it } from "vitest";
import type { Config } from "../../utils/types";
import { compactInteractiveMessages } from "./compaction";

function createConfig(): Config {
	return {
		providerId: "anthropic",
		modelId: "claude-test",
		apiKey: "",
		cwd: "/tmp/project",
		workspaceRoot: "/tmp/project",
		systemPrompt: "system",
		mode: "act",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		verbose: false,
		thinking: false,
		outputMode: "text",
		sandbox: false,
		defaultToolAutoApprove: true,
		toolPolicies: {
			"*": { autoApprove: true },
		},
	};
}

describe("compactInteractiveMessages", () => {
	it("uses the selected model context window when available", async () => {
		const longText = "x".repeat(16_000);
		const messages = Array.from({ length: 10 }, (_, index) => ({
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			content: `message ${index} ${longText}`,
		}));
		const config = createConfig();
		config.knownModels = {
			"claude-test": {
				id: "claude-test",
				contextWindow: 400_000,
			},
		};

		const result = await compactInteractiveMessages({
			config,
			sessionId: "sess-compact",
			messages,
		});

		expect(result.compacted).toBe(false);
		expect(result.messages).toBe(messages);
	});

	it("uses a useful target budget for manual compaction", async () => {
		const longText = "x".repeat(16_000);
		const messages = Array.from({ length: 10 }, (_, index) => ({
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			content: `message ${index} ${longText}`,
		}));

		const result = await compactInteractiveMessages({
			config: createConfig(),
			sessionId: "sess-compact",
			messages,
		});

		const compactedTextLength = result.messages.reduce(
			(total, message) =>
				total +
				(typeof message.content === "string" ? message.content.length : 0),
			0,
		);

		expect(result.compacted).toBe(true);
		expect(result.messages.length).toBeGreaterThan(1);
		expect(result.messages.length).toBeLessThan(messages.length);
		expect(compactedTextLength).toBeGreaterThan(1_000);
	});

	it("reports compaction when core returns changed messages with the same count", async () => {
		const messages = [
			{
				role: "user" as const,
				content: `${" ".repeat(80)}same count but content should be trimmed${" ".repeat(80)}`,
			},
		];
		const config = createConfig();
		config.compaction = {
			contextWindowTokens: 80,
		};

		const result = await compactInteractiveMessages({
			config,
			sessionId: "sess-compact",
			messages,
		});

		expect(result.compacted).toBe(true);
		expect(result.messages).toHaveLength(messages.length);
		expect(result.messages[0]?.content).toBe(
			"same count but content should be trimmed",
		);
	});
});
