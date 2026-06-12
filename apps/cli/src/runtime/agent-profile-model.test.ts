import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHomeDir } from "@cline/shared/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@cline/core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@cline/core")>();
	return {
		...original,
		resolveProviderConfig: vi.fn(async () => ({
			knownModels: {
				"mock/model-a": { name: "Mock Model A" },
				"mock/model-b": { name: "Mock Model B" },
			},
		})),
	};
});

import { ProviderSettingsManager, resolveProviderConfig } from "@cline/core";
import type { Config } from "../utils/types";
import { applyAgentProfileModelSelection } from "./agent-profile-model";

function makeConfig(overrides: Partial<Config> = {}): Config {
	return {
		providerId: "anthropic",
		modelId: "anthropic/claude-sonnet-4.6",
		apiKey: "anthropic-key",
		systemPrompt: "test",
		cwd: process.cwd(),
		verbose: false,
		sandbox: false,
		thinking: false,
		outputMode: "text",
		mode: "act",
		defaultToolAutoApprove: false,
		toolPolicies: {},
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		...overrides,
	};
}

describe("applyAgentProfileModelSelection", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_GLOBAL_SETTINGS_PATH: process.env.CLINE_GLOBAL_SETTINGS_PATH,
	};
	const tempRoots: string[] = [];

	afterEach(async () => {
		process.env.HOME = envSnapshot.HOME;
		process.env.CLINE_GLOBAL_SETTINGS_PATH =
			envSnapshot.CLINE_GLOBAL_SETTINGS_PATH;
		setHomeDir(envSnapshot.HOME ?? "~");
		vi.clearAllMocks();
		for (const root of tempRoots.splice(0)) {
			await rm(root, { recursive: true, force: true });
		}
	});

	async function setUpProviderSettings(): Promise<void> {
		const root = await mkdtemp(join(tmpdir(), "cli-profile-model-"));
		tempRoots.push(root);
		const home = join(root, "home");
		await mkdir(home, { recursive: true });
		process.env.HOME = home;
		setHomeDir(home);
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(home, "global-settings.json");

		const manager = new ProviderSettingsManager();
		manager.saveProviderSettings(
			{
				provider: "openai-compatible",
				model: "openai/gpt-test",
				apiKey: "openai-key",
				reasoning: { enabled: true, effort: "high" },
			},
			{ setLastUsed: false },
		);
		// Saved last: anthropic is the user's persisted selection.
		manager.saveProviderSettings({
			provider: "anthropic",
			model: "anthropic/claude-sonnet-4.6",
			apiKey: "anthropic-key",
		});
	}

	it("applies the profile's provider and model with its stored credentials", async () => {
		await setUpProviderSettings();
		const config = makeConfig();

		const result = await applyAgentProfileModelSelection(config, {
			providerId: "openai-compatible",
			modelId: "openai/gpt-custom",
		});

		expect(result.warning).toBeUndefined();
		expect(config.providerId).toBe("openai-compatible");
		expect(config.modelId).toBe("openai/gpt-custom");
		expect(config.apiKey).toBe("openai-key");
		expect(config.knownModels).toMatchObject({ "mock/model-a": {} });
		expect(config.thinking).toBe(true);
		expect(config.reasoningEffort).toBe("high");
	});

	it("normalizes provider aliases and falls back to that provider's persisted model", async () => {
		await setUpProviderSettings();
		const config = makeConfig();

		// "openai" is a frontmatter alias for "openai-compatible".
		await applyAgentProfileModelSelection(config, { providerId: "openai" });

		expect(config.providerId).toBe("openai-compatible");
		expect(config.modelId).toBe("openai/gpt-test");
	});

	it("applies a model-only profile on the user's provider without provider resolution", async () => {
		await setUpProviderSettings();
		const config = makeConfig();

		await applyAgentProfileModelSelection(config, {
			modelId: "anthropic/claude-haiku-4.5",
		});

		expect(config.providerId).toBe("anthropic");
		expect(config.modelId).toBe("anthropic/claude-haiku-4.5");
		expect(config.apiKey).toBe("anthropic-key");
		expect(resolveProviderConfig).not.toHaveBeenCalled();
	});

	it("warns and keeps the current selection when the profile provider is not configured", async () => {
		await setUpProviderSettings();
		const config = makeConfig();

		const result = await applyAgentProfileModelSelection(config, {
			providerId: "groq",
			modelId: "groq/some-model",
		});

		expect(result.warning).toContain('"groq"');
		expect(config.providerId).toBe("anthropic");
		expect(config.modelId).toBe("anthropic/claude-sonnet-4.6");
		expect(config.apiKey).toBe("anthropic-key");
	});

	it("restores the user's persisted selection when reverting to the default agent", async () => {
		await setUpProviderSettings();
		const config = makeConfig();

		await applyAgentProfileModelSelection(config, {
			providerId: "openai-compatible",
			modelId: "openai/gpt-custom",
		});
		const result = await applyAgentProfileModelSelection(config, undefined);

		expect(result.warning).toBeUndefined();
		expect(config.providerId).toBe("anthropic");
		expect(config.modelId).toBe("anthropic/claude-sonnet-4.6");
		expect(config.apiKey).toBe("anthropic-key");
		expect(config.thinking).toBe(false);
		expect(config.reasoningEffort).toBeUndefined();
	});

	it("restores the persisted selection when switching to a profile without provider or model fields", async () => {
		await setUpProviderSettings();
		const config = makeConfig();

		await applyAgentProfileModelSelection(config, {
			providerId: "openai-compatible",
			modelId: "openai/gpt-custom",
		});
		await applyAgentProfileModelSelection(config, {});

		expect(config.providerId).toBe("anthropic");
		expect(config.modelId).toBe("anthropic/claude-sonnet-4.6");
	});

	it("does not leak a model-only profile's model past the revert when no model is persisted", async () => {
		const root = await mkdtemp(join(tmpdir(), "cli-profile-model-"));
		tempRoots.push(root);
		const home = join(root, "home");
		await mkdir(home, { recursive: true });
		process.env.HOME = home;
		setHomeDir(home);
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(home, "global-settings.json");
		// The user's provider settings carry no model selection.
		new ProviderSettingsManager().saveProviderSettings({
			provider: "anthropic",
			apiKey: "anthropic-key",
		});
		const { Llms } = await import("@cline/core");
		const knownModels = await Llms.getModelsForProvider("anthropic");
		const firstKnownModelId = Object.keys(knownModels)[0];
		const config = makeConfig({ knownModels, modelId: firstKnownModelId });

		const pinned = { modelId: "anthropic/claude-haiku-4.5" };
		await applyAgentProfileModelSelection(config, pinned);
		expect(config.modelId).toBe("anthropic/claude-haiku-4.5");

		await applyAgentProfileModelSelection(config, undefined, {
			previousProfile: pinned,
		});

		expect(config.modelId).toBe(firstKnownModelId);
	});

	it("falls back to the provider's catalog default model when nothing else is available", async () => {
		const root = await mkdtemp(join(tmpdir(), "cli-profile-model-"));
		tempRoots.push(root);
		const home = join(root, "home");
		await mkdir(home, { recursive: true });
		process.env.HOME = home;
		setHomeDir(home);
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(home, "global-settings.json");
		// No persisted model, and the live config carries no known models.
		new ProviderSettingsManager().saveProviderSettings({
			provider: "anthropic",
			apiKey: "anthropic-key",
		});
		const config = makeConfig({ knownModels: undefined });

		const pinned = { modelId: "anthropic/claude-haiku-4.5" };
		await applyAgentProfileModelSelection(config, pinned);
		await applyAgentProfileModelSelection(config, undefined, {
			previousProfile: pinned,
		});

		// Anthropic's catalog default, not the profile's pinned model.
		expect(config.modelId).toBe("claude-sonnet-4-6");
	});

	it("accepts a profile provider configured only through its environment variable", async () => {
		await setUpProviderSettings();
		const previousEnv = process.env.OPENROUTER_API_KEY;
		process.env.OPENROUTER_API_KEY = "env-key";
		try {
			const config = makeConfig();

			const result = await applyAgentProfileModelSelection(config, {
				providerId: "openrouter",
				modelId: "anthropic/claude-sonnet-4.6",
			});

			expect(result.warning).toBeUndefined();
			expect(config.providerId).toBe("openrouter");
			expect(config.modelId).toBe("anthropic/claude-sonnet-4.6");
		} finally {
			if (previousEnv === undefined) {
				delete process.env.OPENROUTER_API_KEY;
			} else {
				process.env.OPENROUTER_API_KEY = previousEnv;
			}
		}
	});

	it("never writes the profile's selection into persisted provider settings", async () => {
		await setUpProviderSettings();
		const config = makeConfig();

		await applyAgentProfileModelSelection(config, {
			providerId: "openai-compatible",
			modelId: "openai/gpt-custom",
		});

		const manager = new ProviderSettingsManager();
		expect(manager.getLastUsedProviderSettings()?.provider).toBe("anthropic");
		expect(manager.getProviderSettings("openai-compatible")?.model).toBe(
			"openai/gpt-test",
		);
	});
});
