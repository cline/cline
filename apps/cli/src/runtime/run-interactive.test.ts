import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../utils/types";
import {
	applyInteractiveModelChange,
	assertHistorySessionIsDeletable,
	resolveReasoningForModelChange,
	resumeInteractiveSession,
} from "./run-interactive";

describe("assertHistorySessionIsDeletable", () => {
	it("rejects deleting the active interactive session", () => {
		expect(() => assertHistorySessionIsDeletable("sess_1", "sess_1")).toThrow(
			"Cannot delete the active session",
		);
	});

	it("allows deleting another or pre-startup session", () => {
		expect(() =>
			assertHistorySessionIsDeletable("sess_1", "sess_2"),
		).not.toThrow();
		expect(() => assertHistorySessionIsDeletable("sess_1", "")).not.toThrow();
	});
});

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

describe("resumeInteractiveSession", () => {
	const originalAgentResume = process.env.CLINE_HOOK_AGENT_RESUME;

	afterEach(() => {
		if (originalAgentResume === undefined) {
			delete process.env.CLINE_HOOK_AGENT_RESUME;
		} else {
			process.env.CLINE_HOOK_AGENT_RESUME = originalAgentResume;
		}
	});

	it("starts the selected session directly without ensuring an empty session first", async () => {
		const messages = [
			{ id: "message-1", role: "user" as const, content: "hello" },
		];
		const ensureReady = vi.fn(async () => {});
		const resumeSession = vi.fn(async () => {
			expect(process.env.CLINE_HOOK_AGENT_RESUME).toBe("1");
			return messages;
		});
		const getAccumulatedUsage = vi.fn(async () => ({
			inputTokens: 12,
			outputTokens: 3,
			totalCost: 0.42,
		}));
		const sessionRuntime = {
			ensureReady,
			resumeSession,
			getAccumulatedUsage,
		};

		const result = await resumeInteractiveSession(
			sessionRuntime,
			"session-selected",
		);

		expect(ensureReady).not.toHaveBeenCalled();
		expect(resumeSession).toHaveBeenCalledOnce();
		expect(resumeSession).toHaveBeenCalledWith("session-selected");
		expect(getAccumulatedUsage).toHaveBeenCalledWith({
			inputTokens: 0,
			outputTokens: 0,
		});
		expect(result).toMatchObject({
			messages,
			totalCost: 0.42,
		});
		expect(process.env.CLINE_HOOK_AGENT_RESUME).toBe("1");
	});

	it("restores the hook state when the selected session cannot resume", async () => {
		delete process.env.CLINE_HOOK_AGENT_RESUME;
		const resumeSession = vi.fn(async () => {
			expect(process.env.CLINE_HOOK_AGENT_RESUME).toBe("1");
			throw new Error("resume failed");
		});

		await expect(
			resumeInteractiveSession(
				{
					resumeSession,
					getAccumulatedUsage: vi.fn(),
				},
				"session-missing",
			),
		).rejects.toThrow("resume failed");

		expect(process.env.CLINE_HOOK_AGENT_RESUME).toBeUndefined();
	});
});
