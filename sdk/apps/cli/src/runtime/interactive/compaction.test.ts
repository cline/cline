import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CoreCompactionContext,
	ProviderSettingsManager,
} from "@cline/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../utils/types";
import {
	compactInteractiveMessages,
	resolveCompactionProviderConfig,
} from "./compaction";

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

const providerSettingsTempDirs: string[] = [];

function createProviderSettingsManager(): ProviderSettingsManager {
	const tempDir = mkdtempSync(join(tmpdir(), "cline-cli-compact-"));
	providerSettingsTempDirs.push(tempDir);
	return new ProviderSettingsManager({
		filePath: join(tempDir, "providers.json"),
	});
}

afterEach(() => {
	for (const tempDir of providerSettingsTempDirs.splice(0)) {
		rmSync(tempDir, { force: true, recursive: true });
	}
});

describe("compactInteractiveMessages", () => {
	it("resolves manual compaction provider config from persisted OAuth settings", () => {
		const manager = createProviderSettingsManager();
		manager.saveProviderSettings({
			provider: "openai-native",
			model: "old-model",
			auth: {
				accessToken: "stored-access-token",
				refreshToken: "stored-refresh-token",
				accountId: "acct-1",
			},
			baseUrl: "https://stored.example.com/v1",
			headers: {
				"x-stored": "yes",
			},
		});
		const config = createConfig();
		config.providerId = "openai-native";
		config.modelId = "gpt-test";

		const providerConfig = resolveCompactionProviderConfig(config, manager);

		expect(providerConfig.providerId).toBe("openai-native");
		expect(providerConfig.modelId).toBe("gpt-test");
		expect(providerConfig.apiKey).toBe("stored-access-token");
		expect(providerConfig.accessToken).toBe("stored-access-token");
		expect(providerConfig.refreshToken).toBe("stored-refresh-token");
		expect(providerConfig.accountId).toBe("acct-1");
		expect(providerConfig.baseUrl).toBe("https://stored.example.com/v1");
		expect(providerConfig.headers).toEqual({ "x-stored": "yes" });
	});

	it("prefers active CLI reasoning effort over persisted provider reasoning settings", () => {
		const manager = createProviderSettingsManager();
		manager.saveProviderSettings({
			provider: "anthropic",
			model: "old-model",
			reasoning: { enabled: true, effort: "low" },
		});
		const config = createConfig();
		config.reasoningEffort = "high";

		const providerConfig = resolveCompactionProviderConfig(config, manager);

		expect(providerConfig.reasoningEffort).toBe("high");
	});

	it("passes the selected model context window to manual compaction", async () => {
		const longText = "x".repeat(16_000);
		const messages = Array.from({ length: 10 }, (_, index) => ({
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			content: `message ${index} ${longText}`,
		}));
		const config = createConfig();
		const compact = vi.fn((context: CoreCompactionContext) => {
			expect(context.maxInputTokens).toBe(400_000);
			return { messages: [messages[0]] };
		});
		config.knownModels = {
			"claude-test": {
				id: "claude-test",
				maxInputTokens: 400_000,
			},
		};
		config.compaction = { compact };

		const result = await compactInteractiveMessages({
			config,
			providerSettingsManager: createProviderSettingsManager(),
			sessionId: "sess-compact",
			messages,
		});

		expect(compact).toHaveBeenCalledTimes(1);
		expect(result.compacted).toBe(true);
		expect(result.messages).toEqual([messages[0]]);
	});

	it("falls back to legacy contextWindow for manual compaction", async () => {
		const longText = "x".repeat(16_000);
		const messages = Array.from({ length: 10 }, (_, index) => ({
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			content: `message ${index} ${longText}`,
		}));
		const config = createConfig();
		const compact = vi.fn((context: CoreCompactionContext) => {
			expect(context.maxInputTokens).toBe(400_000);
			return { messages: [messages[0]] };
		});
		config.knownModels = {
			"claude-test": {
				id: "claude-test",
				contextWindow: 400_000,
			},
		};
		config.compaction = { compact };

		const result = await compactInteractiveMessages({
			config,
			providerSettingsManager: createProviderSettingsManager(),
			sessionId: "sess-compact",
			messages,
		});

		expect(compact).toHaveBeenCalledTimes(1);
		expect(result.compacted).toBe(true);
		expect(result.messages).toEqual([messages[0]]);
	});

	it("uses a useful target budget for manual compaction", async () => {
		const longText = "x".repeat(16_000);
		const messages = Array.from({ length: 10 }, (_, index) => ({
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			content: `message ${index} ${longText}`,
		}));

		const result = await compactInteractiveMessages({
			config: createConfig(),
			providerSettingsManager: createProviderSettingsManager(),
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
			compact: () => ({
				messages: [
					{
						role: "user",
						content: "same count but content should be trimmed",
					},
				],
			}),
		};

		const result = await compactInteractiveMessages({
			config,
			providerSettingsManager: createProviderSettingsManager(),
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
