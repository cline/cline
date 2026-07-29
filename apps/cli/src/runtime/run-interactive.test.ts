import { describe, expect, it, vi } from "vitest";
import type { Config } from "../utils/types";
import {
	applyInteractiveModelChange,
	resolveReasoningForModelChange,
} from "./run-interactive";

describe("resolveReasoningForModelChange", () => {
	it("persists disabled reasoning only when thinking is explicitly false", () => {
		expect(
			resolveReasoningForModelChange(
				{ thinking: false, reasoningEffort: undefined },
				{ reasoning: { enabled: true, effort: "high" } },
			),
		).toEqual({ enabled: false });
	});

	it("persists enabled reasoning with the selected effort", () => {
		expect(
			resolveReasoningForModelChange(
				{ thinking: true, reasoningEffort: "low" },
				{ reasoning: { enabled: false } },
			),
		).toEqual({ enabled: true, effort: "low" });
	});

	it("persists enabled reasoning when thinking is explicitly true without effort", () => {
		expect(
			resolveReasoningForModelChange(
				{ thinking: true, reasoningEffort: undefined },
				{ reasoning: { enabled: false } },
			),
		).toEqual({ enabled: true });
	});

	it("preserves existing reasoning when thinking is unset", () => {
		expect(
			resolveReasoningForModelChange(
				{ thinking: undefined, reasoningEffort: undefined },
				{ reasoning: { enabled: true, effort: "medium" } },
			),
		).toEqual({ enabled: true, effort: "medium" });
	});
});

describe("applyInteractiveModelChange", () => {
	it("restarts with the current transcript so a provider switch reloads its complete configuration", async () => {
		const config = {
			providerId: "openai-compatible",
			modelId: "custom-model",
			apiKey: "new-key",
			thinking: undefined,
			reasoningEffort: undefined,
		} as Config;
		const getProviderSettings = vi.fn(() => ({
			provider: "openai-compatible",
			apiKey: "new-key",
			baseUrl: "https://example.com/v1",
			headers: { "X-Custom-Header": "custom-value" },
			client: "openai-compatible" as const,
			protocol: "openai-chat" as const,
			model: "old-model",
		}));
		const saveProviderSettings = vi.fn(() => ({
			version: 1 as const,
			providers: {},
		}));
		const ensureReady = vi.fn(async () => {});
		const restartWithCurrentMessages = vi.fn(async () => {});
		const updateCurrentSessionConnection = vi.fn(async () => {});

		await applyInteractiveModelChange({
			config,
			providerSettingsManager: {
				getProviderSettings,
				saveProviderSettings,
			},
			sessionRuntime: {
				ensureReady,
				restartWithCurrentMessages,
				updateCurrentSessionConnection,
			},
		});

		expect(saveProviderSettings).toHaveBeenCalledWith({
			provider: "openai-compatible",
			apiKey: "new-key",
			baseUrl: "https://example.com/v1",
			headers: { "X-Custom-Header": "custom-value" },
			client: "openai-compatible",
			protocol: "openai-chat",
			model: "custom-model",
		});
		expect(ensureReady).toHaveBeenCalledOnce();
		expect(restartWithCurrentMessages).toHaveBeenCalledOnce();
		expect(updateCurrentSessionConnection).toHaveBeenCalledWith({
			providerId: "openai-compatible",
			modelId: "custom-model",
		});
		expect(ensureReady.mock.invocationCallOrder[0]).toBeLessThan(
			restartWithCurrentMessages.mock.invocationCallOrder[0] ?? 0,
		);
		expect(saveProviderSettings.mock.invocationCallOrder[0]).toBeLessThan(
			restartWithCurrentMessages.mock.invocationCallOrder[0] ?? 0,
		);
		expect(restartWithCurrentMessages.mock.invocationCallOrder[0]).toBeLessThan(
			updateCurrentSessionConnection.mock.invocationCallOrder[0] ?? 0,
		);
	});
});
