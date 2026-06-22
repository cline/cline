import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { CoreSessionConfig } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	buildResumeSessionInput,
	buildSessionConfig,
	buildStartSessionInput,
	createHistoryItemFromSession,
	getDefaultModelIdForProvider,
	getHistoryItemById,
	normalizeProviderReasoningSettings,
	normalizeSdkBaseUrl,
	resolveApiKey,
	updateHistoryItem,
} from "./cline-session-factory"

const mocks = vi.hoisted(() => {
	const providerSettingsManager = {
		getLastUsedProviderSettings: vi.fn(() => undefined),
		getProviderSettings: vi.fn((_providerId?: string) => undefined),
		saveProviderSettings: vi.fn(),
	}

	return {
		getDistinctId: vi.fn(() => "test-distinct-id"),
		getProviderSettingsManager: vi.fn(() => providerSettingsManager),
		providerSettingsManager,
		stateManager: {
			getApiConfiguration: vi.fn(() => ({
				actModeApiProvider: "anthropic",
				actModeApiModelId: "claude-sonnet-4-6",
				apiKey: "test-key",
			})),
			getGlobalSettingsKey: vi.fn((key: string): boolean | undefined => {
				if (key === "subagentsEnabled" || key === "useAutoCondense") {
					return false
				}
				return undefined
			}),
		},
	}
})

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => mocks.stateManager,
	},
}))

vi.mock("@/services/logging/distinctId", () => ({
	getDistinctId: mocks.getDistinctId,
}))

vi.mock("./provider-migration", () => ({
	getProviderSettingsManager: mocks.getProviderSettingsManager,
}))

vi.mock("@shared/services/Logger", () => ({
	Logger: {
		debug: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-session-factory-"))
	vi.clearAllMocks()
	mocks.stateManager.getApiConfiguration.mockReturnValue({
		actModeApiProvider: "anthropic",
		actModeApiModelId: "claude-sonnet-4-6",
		apiKey: "test-key",
	})
	mocks.stateManager.getGlobalSettingsKey.mockImplementation((key: string) => {
		if (key === "subagentsEnabled" || key === "useAutoCondense") {
			return false
		}
		return undefined
	})
	mocks.providerSettingsManager.getLastUsedProviderSettings.mockReturnValue(undefined)
	mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)
})

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true })
})

function writeJson(filePath: string, data: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function makeBaseConfig(overrides: Partial<CoreSessionConfig> = {}): CoreSessionConfig {
	return {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		apiKey: "test-key",
		cwd: "/tmp/workspace",
		workspaceRoot: "/tmp/workspace",
		systemPrompt: "",
		mode: "act",
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		...overrides,
	}
}

// ---------------------------------------------------------------------------
// provider/model defaults
// ---------------------------------------------------------------------------

describe("getDefaultModelIdForProvider", () => {
	it("uses the SDK provider catalog for the Cline default model", () => {
		expect(getDefaultModelIdForProvider("cline")).toBe("anthropic/claude-sonnet-4.6")
	})

	it("falls back to the first generated model when the SDK manifest default is not in the model catalog", () => {
		expect(getDefaultModelIdForProvider("gemini")).toBe("gemini-3.5-flash")
	})

	it("returns undefined for unknown providers", () => {
		expect(getDefaultModelIdForProvider("unknown-provider")).toBeUndefined()
	})

	it("resolves the OpenAI Compatible default through the extension's openai alias", () => {
		// The extension stores the OpenAI Compatible provider as "openai" while
		// the SDK catalog keys it as "openai-compatible". toSdkProviderId bridges
		// the two so the catalog default-model lookup resolves.
		expect(getDefaultModelIdForProvider("openai")).toBe("gpt-4o")
	})
})

// ---------------------------------------------------------------------------
// buildStartSessionInput
// ---------------------------------------------------------------------------

describe("buildStartSessionInput", () => {
	it("does not forward the prompt to start()", () => {
		const config = makeBaseConfig()
		const input = {
			prompt: "Hello, world!",
			cwd: "/tmp/workspace",
		}

		const result = buildStartSessionInput(config, input)

		expect(result.config).toBe(config)
		expect(result.prompt).toBeUndefined()
		expect(result.interactive).toBe(true)
		expect(result.userImages).toBeUndefined()
		expect(result.userFiles).toBeUndefined()
	})

	it("includes images and files when provided", () => {
		const config = makeBaseConfig()
		const input = {
			prompt: "Look at this",
			images: ["image1.png", "image2.jpg"],
			files: ["file1.ts"],
			cwd: "/tmp/workspace",
		}

		const result = buildStartSessionInput(config, input)

		expect(result.userImages).toEqual(["image1.png", "image2.jpg"])
		expect(result.userFiles).toEqual(["file1.ts"])
	})

	it("always sets interactive to true", () => {
		const config = makeBaseConfig()
		const input = { cwd: "/tmp/workspace" }

		const result = buildStartSessionInput(config, input)

		expect(result.interactive).toBe(true)
	})

	it("handles undefined prompt", () => {
		const config = makeBaseConfig()
		const input = { cwd: "/tmp/workspace" }

		const result = buildStartSessionInput(config, input)

		expect(result.prompt).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// buildResumeSessionInput
// ---------------------------------------------------------------------------

describe("buildResumeSessionInput", () => {
	it("builds resume input with session ID and prompt", () => {
		const result = buildResumeSessionInput("session-123", "Continue the task")

		expect(result.sessionId).toBe("session-123")
		expect(result.prompt).toBe("Continue the task")
		expect(result.userImages).toBeUndefined()
		expect(result.userFiles).toBeUndefined()
	})

	it("includes images and files when provided", () => {
		const result = buildResumeSessionInput("session-123", "Look at this", ["img.png"], ["file.ts"])

		expect(result.userImages).toEqual(["img.png"])
		expect(result.userFiles).toEqual(["file.ts"])
	})
})

// ---------------------------------------------------------------------------
// normalizeSdkBaseUrl
// ---------------------------------------------------------------------------

describe("normalizeSdkBaseUrl", () => {
	it("treats blank base URLs as unset so SDK provider defaults can apply", () => {
		expect(normalizeSdkBaseUrl("openai-compatible", "")).toBeUndefined()
		expect(normalizeSdkBaseUrl("openai-compatible", "   ")).toBeUndefined()
	})

	it("uses provider catalog defaults to add the SDK endpoint path when the user supplies only an origin", () => {
		expect(normalizeSdkBaseUrl("ollama", "http://localhost:11434")).toBe("http://localhost:11434/v1")
		expect(normalizeSdkBaseUrl("ollama", "http://localhost:11434/")).toBe("http://localhost:11434/v1")
		expect(normalizeSdkBaseUrl("ollama", "http://localhost:11434/v1")).toBe("http://localhost:11434/v1")
	})

	it("preserves explicit user paths", () => {
		expect(normalizeSdkBaseUrl("openai", " https://example.com/custom ")).toBe("https://example.com/custom")
	})
})

// ---------------------------------------------------------------------------
// normalizeProviderReasoningSettings
// ---------------------------------------------------------------------------

describe("normalizeProviderReasoningSettings", () => {
	it("does not emit reasoningEffort when thinking is disabled", () => {
		const result = normalizeProviderReasoningSettings({ enabled: false, effort: "medium" })

		expect(result).toEqual({ thinking: false })
	})

	it("treats effort none as disabled thinking", () => {
		const result = normalizeProviderReasoningSettings({ effort: "none" })

		expect(result).toEqual({ thinking: false })
	})

	it("passes enabled reasoning with a concrete effort", () => {
		const result = normalizeProviderReasoningSettings({ enabled: true, effort: "high" })

		expect(result).toEqual({ thinking: true, reasoningEffort: "high" })
	})

	it("leaves explicit effort-only settings enabled by SDK/provider defaults", () => {
		const result = normalizeProviderReasoningSettings({ effort: "medium" })

		expect(result).toEqual({ reasoningEffort: "medium" })
	})
})

// ---------------------------------------------------------------------------
// buildSessionConfig
// ---------------------------------------------------------------------------

describe("buildSessionConfig", () => {
	it("resolves Cline OAuth credentials after defaulting to the Cline provider", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({} as any)
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue({
			provider: "cline",
			auth: {
				accessToken: "workos:test-access-token",
				refreshToken: "test-refresh-token",
			},
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerId).toBe("cline")
		expect(config.apiKey).toBe("workos:test-access-token")
	})

	it("resolves ClinePass from the shared Cline OAuth credentials", async () => {
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId?: string) => {
			if (providerId !== "cline") {
				return undefined
			}
			return {
				provider: "cline",
				auth: {
					accessToken: "workos:shared-cline-token",
					refreshToken: "shared-refresh-token",
				},
			} as any
		})

		const apiKey = resolveApiKey("cline-pass", {
			actModeApiProvider: "cline-pass",
		} as any)

		expect(apiKey).toBe("workos:shared-cline-token")
		expect(mocks.providerSettingsManager.getProviderSettings).toHaveBeenCalledWith("cline")
	})

	it("preserves explicit ClinePass API keys from state before OAuth storage", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue({
			provider: "cline",
			auth: { accessToken: "workos:stored-token" },
		} as any)

		expect(resolveApiKey("cline-pass", { clineApiKey: "workos:configured-token" } as any)).toBe("workos:configured-token")
		expect(mocks.providerSettingsManager.getProviderSettings).not.toHaveBeenCalled()
	})

	it("preserves explicit Cline API keys from state before OAuth storage", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue({
			provider: "cline",
			auth: { accessToken: "workos:stored-token" },
		} as any)

		expect(resolveApiKey("cline", { clineApiKey: "workos:configured-cline-token" } as any)).toBe(
			"workos:configured-cline-token",
		)
		expect(mocks.providerSettingsManager.getProviderSettings).not.toHaveBeenCalled()
	})

	it("resolves OpenAI Codex through the shared OAuth provider registry", async () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue({
			provider: "openai-codex",
			auth: {
				accessToken: "codex-oauth-token",
				refreshToken: "codex-refresh-token",
			},
		} as any)
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "openai-codex",
			actModeApiModelId: "gpt-5.4",
			openAiNativeApiKey: "openai-api-key-should-not-be-used",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerId).toBe("openai-codex")
		expect(config.modelId).toBe("gpt-5.4")
		expect(config.apiKey).toBe("codex-oauth-token")
		expect(config.providerConfig).toMatchObject({
			providerId: "openai-codex",
			modelId: "gpt-5.4",
			apiKey: "codex-oauth-token",
		})
	})

	it("resolves SDK-backed provider API keys from provider-specific settings", async () => {
		const providers = [
			{ providerId: "poolside", modelId: "poolside/laguna-m.1:free" },
			{ providerId: "v0", modelId: "v0-1.5-md" },
			{ providerId: "xiaomi", modelId: "mimo-v2-omni" },
			{ providerId: "zai-coding-plan", modelId: "glm-5.2" },
		] as const

		for (const { providerId, modelId } of providers) {
			mocks.providerSettingsManager.getProviderSettings.mockImplementation((requestedProviderId?: string) => {
				if (requestedProviderId !== providerId) {
					return undefined
				}
				return {
					provider: providerId,
					apiKey: `${providerId}-key`,
				} as any
			})
			mocks.stateManager.getApiConfiguration.mockReturnValue({
				actModeApiProvider: providerId,
				actModeApiModelId: modelId,
			} as any)

			const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

			expect(config.providerId).toBe(providerId)
			expect(config.modelId).toBe(modelId)
			expect(config.apiKey).toBe(`${providerId}-key`)
			expect(config.providerConfig).toMatchObject({
				providerId,
				modelId,
				apiKey: `${providerId}-key`,
			})
		}
	})

	it("does not treat OpenAI Codex as OpenAI Native API-key auth", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "openai-codex",
			actModeApiModelId: "gpt-5.4",
			openAiNativeApiKey: "openai-api-key-should-not-be-used",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerId).toBe("openai-codex")
		expect(config.modelId).toBe("gpt-5.4")
		expect(config.apiKey).toBe("")
		expect(config.providerConfig).toMatchObject({ providerId: "openai-codex", modelId: "gpt-5.4" })
		expect(config.providerConfig).not.toHaveProperty("apiKey")
	})

	it("passes OpenAI Compatible custom model metadata through as SDK knownModels", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "openai",
			actModeOpenAiModelId: "custom-reasoner",
			openAiApiKey: "openai-compatible-key",
			openAiBaseUrl: "https://openai-compatible.example/v1",
			actModeOpenAiModelInfo: {
				name: "Custom Reasoner",
				contextWindow: 16_000,
				maxTokens: 4_096,
				supportsImages: false,
				supportsPromptCache: false,
				supportsReasoning: true,
				inputPrice: 0,
				outputPrice: 0,
			},
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerId).toBe("openai-compatible")
		expect(config.modelId).toBe("custom-reasoner")
		expect(config.knownModels?.["custom-reasoner"]).toMatchObject({
			id: "custom-reasoner",
			name: "Custom Reasoner",
			contextWindow: 16_000,
			maxInputTokens: 16_000,
			maxTokens: 4_096,
			capabilities: ["streaming", "tools"],
		})
		expect((config.providerConfig as any).knownModels?.["custom-reasoner"]).toMatchObject({
			contextWindow: 16_000,
			maxInputTokens: 16_000,
			maxTokens: 4_096,
		})
		expect((config.providerConfig as any).maxOutputTokens).toBe(4_096)
	})

	it("uses ClinePass model storage and omits empty nested apiKey so SDK OAuth can fill it", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "cline-pass",
			actModeClinePassModelId: "cline-pass/glm-5.1",
		} as any)
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerId).toBe("cline-pass")
		expect(config.modelId).toBe("cline-pass/glm-5.1")
		expect(config.apiKey).toBe("")
		expect(config.providerConfig).toMatchObject({ providerId: "cline-pass", modelId: "cline-pass/glm-5.1" })
		expect(config.providerConfig).not.toHaveProperty("apiKey")
	})

	it("enables basic SDK compaction when global useAutoCondense is true", async () => {
		mocks.stateManager.getGlobalSettingsKey.mockImplementation((key: string) => {
			if (key === "useAutoCondense") {
				return true
			}
			if (key === "subagentsEnabled") {
				return false
			}
			return undefined
		})

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.compaction).toEqual({
			enabled: true,
			strategy: "basic",
		})
	})

	it("does not enable SDK compaction when global useAutoCondense is false", async () => {
		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.compaction).toBeUndefined()
	})

	it("lets task useAutoCondense override the global setting", async () => {
		let globalUseAutoCondense = true
		mocks.stateManager.getGlobalSettingsKey.mockImplementation((key: string) => {
			if (key === "useAutoCondense") {
				return globalUseAutoCondense
			}
			if (key === "subagentsEnabled") {
				return false
			}
			return undefined
		})

		// Task `false` overrides global `true`.
		const disabledConfig = await buildSessionConfig({
			cwd: "/tmp/workspace",
			taskSettings: { useAutoCondense: false },
		})

		// Task `true` overrides global `false`.
		globalUseAutoCondense = false
		const enabledConfig = await buildSessionConfig({
			cwd: "/tmp/workspace",
			taskSettings: { useAutoCondense: true },
		})

		expect(disabledConfig.compaction).toBeUndefined()
		expect(enabledConfig.compaction).toEqual({
			enabled: true,
			strategy: "basic",
		})
	})
})

// ---------------------------------------------------------------------------
// createHistoryItemFromSession
// ---------------------------------------------------------------------------

describe("createHistoryItemFromSession", () => {
	it("creates a HistoryItem from session data", () => {
		const item = createHistoryItemFromSession(
			"session-abc",
			"Fix the bug in main.ts",
			"claude-sonnet-4-6",
			"/home/user/project",
		)

		expect(item.id).toBe("session-abc")
		expect(item.task).toBe("Fix the bug in main.ts")
		expect(item.modelId).toBe("claude-sonnet-4-6")
		expect(item.cwdOnTaskInitialization).toBe("/home/user/project")
		expect(item.tokensIn).toBe(0)
		expect(item.tokensOut).toBe(0)
		expect(item.totalCost).toBe(0)
		expect(item.ts).toBeGreaterThan(0)
	})

	it("handles missing optional fields", () => {
		const item = createHistoryItemFromSession("session-xyz", "Simple task")

		expect(item.modelId).toBeUndefined()
		expect(item.cwdOnTaskInitialization).toBeUndefined()
	})

	it("creates unique timestamps for different calls", () => {
		const item1 = createHistoryItemFromSession("s1", "Task 1")
		const item2 = createHistoryItemFromSession("s2", "Task 2")

		// Timestamps should be at least as large (may be same if called in same ms)
		expect(item2.ts).toBeGreaterThanOrEqual(item1.ts)
	})
})

// ---------------------------------------------------------------------------
// getHistoryItemById
// ---------------------------------------------------------------------------

describe("getHistoryItemById", () => {
	it("returns undefined when task is not found", () => {
		const result = getHistoryItemById("nonexistent", tempDir)
		expect(result).toBeUndefined()
	})

	it("finds a task by ID", () => {
		const history = [
			{ id: "task-1", ts: Date.now(), task: "First task", tokensIn: 0, tokensOut: 0, totalCost: 0 },
			{ id: "task-2", ts: Date.now(), task: "Second task", tokensIn: 0, tokensOut: 0, totalCost: 0 },
		]
		writeJson(path.join(tempDir, "state", "taskHistory.json"), history)

		const result = getHistoryItemById("task-2", tempDir)
		expect(result).toBeDefined()
		expect(result?.id).toBe("task-2")
		expect(result?.task).toBe("Second task")
	})

	it("returns undefined for empty history", () => {
		writeJson(path.join(tempDir, "state", "taskHistory.json"), [])

		const result = getHistoryItemById("task-1", tempDir)
		expect(result).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// updateHistoryItem
// ---------------------------------------------------------------------------

describe("updateHistoryItem", () => {
	it("adds a new item to history", () => {
		writeJson(path.join(tempDir, "state", "taskHistory.json"), [])

		const newItem: import("@shared/HistoryItem").HistoryItem = {
			id: "task-new",
			ts: Date.now(),
			task: "New task",
			tokensIn: 100,
			tokensOut: 50,
			totalCost: 0.01,
		}

		const result = updateHistoryItem(newItem, tempDir)
		expect(result).toHaveLength(1)
		expect(result[0].id).toBe("task-new")
	})

	it("updates an existing item in history", () => {
		const existingItem = {
			id: "task-1",
			ts: Date.now(),
			task: "Original task",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		}
		writeJson(path.join(tempDir, "state", "taskHistory.json"), [existingItem])

		const updatedItem = {
			...existingItem,
			tokensIn: 500,
			tokensOut: 250,
			totalCost: 0.05,
		}

		const result = updateHistoryItem(updatedItem, tempDir)
		expect(result).toHaveLength(1)
		expect(result[0].tokensIn).toBe(500)
		expect(result[0].totalCost).toBe(0.05)
	})

	it("prepends new items to the beginning of history", () => {
		const existingItem = {
			id: "task-old",
			ts: Date.now() - 1000,
			task: "Old task",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		}
		writeJson(path.join(tempDir, "state", "taskHistory.json"), [existingItem])

		const newItem = {
			id: "task-new",
			ts: Date.now(),
			task: "New task",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		}

		const result = updateHistoryItem(newItem, tempDir)
		expect(result).toHaveLength(2)
		expect(result[0].id).toBe("task-new")
		expect(result[1].id).toBe("task-old")
	})
})
