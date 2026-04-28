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

		const compacted = await compactInteractiveMessages({
			config,
			sessionId: "sess-compact",
			messages,
		});

		expect(compacted).toBe(messages);
	});

	it("uses a useful target budget for manual compaction", async () => {
		const longText = "x".repeat(16_000);
		const messages = Array.from({ length: 10 }, (_, index) => ({
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			content: `message ${index} ${longText}`,
		}));

		const compacted = await compactInteractiveMessages({
			config: createConfig(),
			sessionId: "sess-compact",
			messages,
		});

		const compactedTextLength = compacted.reduce(
			(total, message) =>
				total +
				(typeof message.content === "string" ? message.content.length : 0),
			0,
		);

		expect(compacted.length).toBeGreaterThan(1);
		expect(compacted.length).toBeLessThan(messages.length);
		expect(compactedTextLength).toBeGreaterThan(1_000);
	});
});
