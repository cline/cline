import { describe, expect, it, vi } from "vitest";
import { getLocalCliInfo } from "../../../utils/local-cli";

vi.mock("../../../utils/local-cli", () => ({
	getLocalCliInfo: () => undefined,
}));

import {
	canContinueLocalCliSetup,
	getMainMenuOptions,
	getOAuthProviderLabel,
	resolveProviderSetupRoute,
	shouldUseFeaturedClineModelPicker,
	toModelEntriesFromKnownModels,
	toModelEntry,
	toProviderEntry,
} from "./model";

describe("onboarding model helpers", () => {
	it("hides ClinePass from the main menu unless its feature flag is enabled", () => {
		expect(
			getMainMenuOptions().some((option) => option.value === "cline-pass"),
		).toBe(false);
		expect(
			getMainMenuOptions({ isClinePassEnabled: false }).some(
				(option) => option.value === "cline-pass",
			),
		).toBe(false);
		expect(
			getMainMenuOptions({ isClinePassEnabled: true }).some(
				(option) => option.value === "cline-pass",
			),
		).toBe(true);
	});

	it("maps provider catalog entries into onboarding provider entries", () => {
		expect(
			toProviderEntry({
				id: "cline",
				name: "Cline",
				apiKey: "",
				oauthAccessTokenPresent: true,
				models: 12,
				defaultModelId: "openai/gpt-5.3-codex",
			}),
		).toEqual({
			id: "cline",
			name: "Cline",
			isOAuth: true,
			isLocalAuth: false,
			hasAuth: true,
			models: 12,
			defaultModelId: "openai/gpt-5.3-codex",
		});
	});

	it("treats API key providers as authenticated when an API key exists", () => {
		expect(
			toProviderEntry({
				id: "anthropic",
				name: "Anthropic",
				apiKey: "sk-test",
				models: null,
			}),
		).toMatchObject({
			id: "anthropic",
			isOAuth: false,
			isLocalAuth: false,
			hasAuth: true,
			models: null,
		});
	});

	it("marks the OpenAI Codex CLI provider as local auth", () => {
		expect(
			toProviderEntry({
				id: "openai-codex-cli",
				name: "OpenAI Codex CLI",
				models: null,
			}),
		).toMatchObject({
			id: "openai-codex-cli",
			isOAuth: false,
			isLocalAuth: true,
		});
	});

	it("marks the Claude Code provider as local auth", () => {
		expect(
			toProviderEntry({
				id: "claude-code",
				name: "Claude Code",
				models: null,
			}),
		).toMatchObject({
			id: "claude-code",
			isOAuth: false,
			isLocalAuth: true,
		});
	});

	it("maps model names and reasoning support strictly", () => {
		expect(
			toModelEntry({
				id: "anthropic/claude-sonnet-4.6",
				supportsReasoning: false,
			}),
		).toEqual({
			id: "anthropic/claude-sonnet-4.6",
			name: "anthropic/claude-sonnet-4.6",
			supportsReasoning: false,
		});

		expect(
			toModelEntry({
				id: "openai/gpt-5.3-codex",
				name: "GPT-5.3 Codex",
				supportsReasoning: true,
			}),
		).toEqual({
			id: "openai/gpt-5.3-codex",
			name: "GPT-5.3 Codex",
			supportsReasoning: true,
		});
	});

	it("maps resolved known models into sorted onboarding model entries", () => {
		expect(
			toModelEntriesFromKnownModels({
				"gpt-5.2": {
					name: "GPT-5.2",
					capabilities: ["tools"],
				},
				"gpt-5.3-codex": {
					name: "GPT-5.3 Codex",
					capabilities: ["tools", "reasoning"],
				},
			}),
		).toEqual([
			{
				id: "gpt-5.2",
				name: "GPT-5.2",
				supportsReasoning: false,
			},
			{
				id: "gpt-5.3-codex",
				name: "GPT-5.3 Codex",
				supportsReasoning: true,
			},
		]);
	});

	it("keeps non-chat models out of the onboarding model picker", () => {
		expect(
			toModelEntriesFromKnownModels({
				"operation-only-whisper": {
					name: "Operation-only Whisper",
					operation: "transcription",
				},
				"whisper-large-v3": {
					name: "Whisper Large V3",
					modalities: { input: ["audio"], output: ["text"] },
				},
				"llama-chat": {
					name: "Llama Chat",
					modalities: { input: ["text"], output: ["text"] },
				},
			}),
		).toEqual([
			{
				id: "llama-chat",
				name: "Llama Chat",
				supportsReasoning: false,
			},
		]);
	});

	it("formats OAuth provider labels for onboarding status views", () => {
		expect(getOAuthProviderLabel("cline")).toBe("Cline");
		expect(getOAuthProviderLabel("cline-pass")).toBe("ClinePass");
		expect(getOAuthProviderLabel("openai-codex")).toBe("ChatGPT");
		expect(getOAuthProviderLabel("oca")).toBe("oca");
	});

	it("uses the featured Cline model picker for the Cline and ClinePass providers", () => {
		expect(shouldUseFeaturedClineModelPicker("cline")).toBe(true);
		expect(shouldUseFeaturedClineModelPicker("cline-pass")).toBe(true);
		expect(shouldUseFeaturedClineModelPicker("anthropic")).toBe(false);
	});
});

describe("local-auth setup routing", () => {
	// A provider can declare `local-auth` without naming a CLI we can probe.
	// Routing must follow the capability; the descriptor is only for probing.
	// Otherwise it falls through to the API-key form, which renders no fields
	// for a local-auth provider.
	it("routes a local-auth provider with no CLI descriptor to local setup", () => {
		expect(getLocalCliInfo("claude-code")).toBeUndefined();
		expect(resolveProviderSetupRoute("claude-code")).toBe("local_cli");
	});

	it("routes OAuth and API-key providers unchanged", () => {
		expect(resolveProviderSetupRoute("anthropic")).toBe("api_key");
	});

	// The probe only looks on PATH, while the runtime also accepts an explicit
	// pathToClaudeCodeExecutable and a bundled platform binary. A PATH miss
	// therefore means "not on PATH", not "unusable", so it must not block.
	it("lets the user continue when the CLI is not found on PATH", () => {
		const cli = { command: "claude", docsUrl: "https://example.invalid" };
		expect(
			canContinueLocalCliSetup(cli, {
				installed: false,
				reason: "The claude executable was not found on PATH.",
			}),
		).toBe(true);
	});
});
