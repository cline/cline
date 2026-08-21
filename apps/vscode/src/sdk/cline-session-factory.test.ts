import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { CoreSessionConfig } from "@cline/core"
import * as LlmsModels from "@cline/llms"
import { ApiFormat } from "@shared/proto/cline/models"
import { Logger } from "@shared/services/Logger"
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
import { parseProviderId } from "./model-catalog/provider-id"
import { createProviderConfigStore } from "./model-catalog/store"

const mocks = vi.hoisted(() => {
	const providerSettingsManager = {
		getFilePath: vi.fn(() => path.join(tempDir, "settings", "providers.json")),
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
			setGlobalStateBatch: vi.fn(),
			setGlobalState: vi.fn(),
			setSecret: vi.fn(),
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
const previousGlobalSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH
const previousDataDir = process.env.CLINE_DATA_DIR

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-session-factory-"))
	process.env.CLINE_DATA_DIR = tempDir
	process.env.CLINE_GLOBAL_SETTINGS_PATH = path.join(tempDir, "global-settings.json")
	vi.clearAllMocks()
	LlmsModels.resetRegistry()
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
	mocks.providerSettingsManager.getFilePath.mockReturnValue(path.join(tempDir, "settings", "providers.json"))
	mocks.providerSettingsManager.getLastUsedProviderSettings.mockReturnValue(undefined)
	mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)
})

afterEach(() => {
	process.env.CLINE_GLOBAL_SETTINGS_PATH = previousGlobalSettingsPath
	process.env.CLINE_DATA_DIR = previousDataDir
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
		expect(getDefaultModelIdForProvider("cline")).toBe(
			LlmsModels.MODEL_COLLECTIONS_BY_PROVIDER_ID.cline.provider.defaultModelId,
		)
	})

	it("uses the generated Gemini provider default", () => {
		expect(getDefaultModelIdForProvider("gemini")).toBe(
			LlmsModels.MODEL_COLLECTIONS_BY_PROVIDER_ID.gemini.provider.defaultModelId,
		)
	})

	it("returns undefined for unknown providers", () => {
		expect(getDefaultModelIdForProvider("unknown-provider")).toBeUndefined()
	})

	it("returns no default for local-model-source providers so a cloud-catalog model is never silently selected", () => {
		expect(getDefaultModelIdForProvider("ollama")).toBeUndefined()
		expect(getDefaultModelIdForProvider("lmstudio")).toBeUndefined()
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

	it("passes Ollama origins through unchanged (the native-API vendor appends /api itself)", () => {
		expect(normalizeSdkBaseUrl("ollama", "http://localhost:11434")).toBe("http://localhost:11434")
		expect(normalizeSdkBaseUrl("ollama", "http://localhost:11434/")).toBe("http://localhost:11434/")
		// Legacy 4.0.x configs may carry the OpenAI-compat /v1 suffix; it is
		// preserved here and rewritten to /api by the vendor.
		expect(normalizeSdkBaseUrl("ollama", "http://localhost:11434/v1")).toBe("http://localhost:11434/v1")
	})

	it("preserves explicit user paths", () => {
		expect(normalizeSdkBaseUrl("openai", " https://example.com/custom ")).toBe("https://example.com/custom")
	})

	it("inherits the AskSage default /server path when the custom URL has no path", () => {
		expect(normalizeSdkBaseUrl("asksage", "https://asksage.internal.example")).toBe("https://asksage.internal.example/server")
		expect(normalizeSdkBaseUrl("asksage", "https://asksage.internal.example/custom")).toBe(
			"https://asksage.internal.example/custom",
		)
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

	it("honors a migrated legacy budget as thinking-on with a derived effort", () => {
		expect(normalizeProviderReasoningSettings({ budgetTokens: 1024 })).toEqual({
			thinking: true,
			reasoningEffort: "low",
		})
		expect(normalizeProviderReasoningSettings({ budgetTokens: 6000 })).toEqual({
			thinking: true,
			reasoningEffort: "medium",
		})
		expect(normalizeProviderReasoningSettings({ budgetTokens: 32_767 })).toEqual({
			thinking: true,
			reasoningEffort: "high",
		})
	})

	it("derives an effort from the budget when enabled without an effort", () => {
		const result = normalizeProviderReasoningSettings({ enabled: true, budgetTokens: 4096 })

		expect(result).toEqual({ thinking: true, reasoningEffort: "medium" })
	})

	it("prefers an explicit effort over a stored budget", () => {
		const result = normalizeProviderReasoningSettings({ enabled: true, effort: "xhigh", budgetTokens: 1024 })

		expect(result).toEqual({ thinking: true, reasoningEffort: "xhigh" })
	})

	it("keeps disabled reasoning off even with a stored budget", () => {
		const result = normalizeProviderReasoningSettings({ enabled: false, budgetTokens: 4096 })

		expect(result).toEqual({ thinking: false })
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

	it("resolves OpenAI Compatible API keys from migrated SDK provider settings", () => {
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId?: string) => {
			if (providerId !== "openai-compatible") {
				return undefined
			}
			return {
				provider: "openai-compatible",
				apiKey: "migrated-openai-compatible-key",
			} as any
		})

		expect(resolveApiKey("openai", {} as any)).toBe("migrated-openai-compatible-key")
		expect(mocks.providerSettingsManager.getProviderSettings).toHaveBeenCalledWith("openai-compatible")
	})

	it("resolves the OpenAI Compatible base URL when the provider is stored under its SDK spelling", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "openai-compatible",
			actModeApiModelId: "openai/gpt-4o-mini",
			openAiApiKey: "compat-key",
			openAiBaseUrl: "http://127.0.0.1:4141/v1",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerId).toBe("openai-compatible")
		// Without the base URL, ProviderConfig consumers that don't re-resolve
		// settings (e.g. the compaction summarizer) would hit the provider
		// default endpoint (api.openai.com) instead of the configured one.
		expect(config.baseUrl).toBe("http://127.0.0.1:4141/v1")
		expect(config.providerConfig).toMatchObject({
			providerId: "openai-compatible",
			baseUrl: "http://127.0.0.1:4141/v1",
		})
	})

	it("falls back to the providers.json base URL when legacy state has none", async () => {
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId?: string) => {
			if (providerId !== "openai-compatible") {
				return undefined
			}
			return {
				provider: "openai-compatible",
				apiKey: "compat-key",
				baseUrl: "http://127.0.0.1:4141/v1",
			} as any
		})
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "openai-compatible",
			actModeApiModelId: "openai/gpt-4o-mini",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.baseUrl).toBe("http://127.0.0.1:4141/v1")
		expect(config.providerConfig).toMatchObject({
			providerId: "openai-compatible",
			baseUrl: "http://127.0.0.1:4141/v1",
		})
	})

	it("resolves the AskSage base URL from the legacy asksageApiUrl state field", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "asksage",
			actModeApiModelId: "gpt-4o",
			asksageApiKey: "asksage-key",
			asksageApiUrl: "https://asksage.internal.example/server",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerId).toBe("asksage")
		// Without this mapping the custom URL saved in legacy state was
		// silently ignored and requests went to the builtin default
		// (https://api.asksage.ai/server).
		expect(config.baseUrl).toBe("https://asksage.internal.example/server")
		expect(config.providerConfig).toMatchObject({
			providerId: "asksage",
			baseUrl: "https://asksage.internal.example/server",
		})
	})

	it("falls back to the providers.json AskSage base URL when legacy state has none", async () => {
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId?: string) => {
			if (providerId !== "asksage") {
				return undefined
			}
			return {
				provider: "asksage",
				apiKey: "asksage-key",
				baseUrl: "https://asksage.migrated.example/server",
			} as any
		})
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "asksage",
			actModeApiModelId: "gpt-4o",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.baseUrl).toBe("https://asksage.migrated.example/server")
		expect(config.providerConfig).toMatchObject({
			providerId: "asksage",
			baseUrl: "https://asksage.migrated.example/server",
		})
	})

	it("forwards the regional API line from legacy state so the gateway can route to the regional endpoint", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "zai",
			actModeApiModelId: "glm-5.2",
			zaiApiKey: "zai-key",
			zaiApiLine: "china",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerId).toBe("zai")
		expect(config.providerConfig).toMatchObject({
			providerId: "zai",
			apiLine: "china",
		})
		// No explicit base URL: the SDK gateway resolves the China endpoint
		// (open.bigmodel.cn) from apiLine; a pre-filled base URL would win
		// over that resolution.
		expect(config.baseUrl).toBeUndefined()
	})

	it("falls back to the providers.json apiLine when legacy state has none", async () => {
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId?: string) => {
			if (providerId !== "moonshot") {
				return undefined
			}
			return {
				provider: "moonshot",
				apiKey: "moonshot-key",
				apiLine: "china",
			} as any
		})
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "moonshot",
			actModeApiModelId: "kimi-k3",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerConfig).toMatchObject({
			providerId: "moonshot",
			apiLine: "china",
		})
	})

	it("inherits the base provider's legacy apiLine for coding variants", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "zai-coding-plan",
			actModeApiModelId: "glm-5.2",
			zaiApiKey: "zai-key",
			zaiApiLine: "china",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerConfig).toMatchObject({
			providerId: "zai-coding-plan",
			apiLine: "china",
		})
	})

	it("prefers the coding variant's own providers.json apiLine over the shared legacy field", async () => {
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId?: string) => {
			if (providerId !== "qwen-code") {
				return undefined
			}
			return {
				provider: "qwen-code",
				apiKey: "qwen-code-key",
				apiLine: "international",
			} as any
		})
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "qwen-code",
			actModeApiModelId: "qwen3-coder-plus",
			qwenApiLine: "china",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerConfig).toMatchObject({
			providerId: "qwen-code",
			apiLine: "international",
		})
	})

	it("omits apiLine for unrecognized values", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "qwen",
			actModeApiModelId: "qwen-plus-latest",
			qwenApiKey: "qwen-key",
			qwenApiLine: "mars",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerConfig).not.toHaveProperty("apiLine")
	})

	it("exposes knownModels at the top level so manual compaction can budget against the model catalog", async () => {
		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		const providerConfigKnownModels = (config.providerConfig as { knownModels?: Record<string, unknown> }).knownModels
		expect(providerConfigKnownModels).toBeDefined()
		expect(config.knownModels).toBe(providerConfigKnownModels)
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
			{ providerId: "poolside", modelId: "poolside/laguna-m.1" },
			{ providerId: "v0", modelId: "v0-1.5-md" },
			{ providerId: "xiaomi", modelId: "mimo-v2.5" },
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

	it("preserves rich SDK catalog entries without extension-side replacement", async () => {
		const expectedModel = structuredClone((await LlmsModels.getModelsForProvider("anthropic"))["claude-sonnet-4-6"])
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "anthropic",
			actModeApiModelId: "claude-sonnet-4-6",
			apiKey: "anthropic-key",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })
		const knownModel = (config.providerConfig as any).knownModels["claude-sonnet-4-6"]

		expect(knownModel).toEqual(expectedModel)
		expect(knownModel.capabilities).toEqual(
			expect.arrayContaining(["images", "files", "tools", "reasoning", "structured_output", "temperature", "prompt-cache"]),
		)
		expect(knownModel.pricing).toEqual(expectedModel.pricing)
		expect(knownModel.releaseDate).toBe(expectedModel.releaseDate)
		expect(knownModel.family).toBe(expectedModel.family)
	})

	it("injects cached LiteLLM max input tokens when the dynamic model is absent from the SDK registry", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "litellm",
			actModeLiteLlmModelId: "openai/grok-4.6",
			liteLlmApiKey: "litellm-key",
			actModeLiteLlmModelInfo: {
				name: "xai/grok-4.6",
				contextWindow: 500_000,
				maxInputTokens: 500_000,
				maxTokens: 64_000,
				supportsPromptCache: false,
			},
		} as any)
		const getModelsSpy = vi.spyOn(LlmsModels, "getModelsForProvider").mockResolvedValueOnce({})

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })
		const knownModel = (config.providerConfig as any).knownModels["openai/grok-4.6"]

		expect(config.providerId).toBe("litellm")
		expect(knownModel).toMatchObject({
			id: "openai/grok-4.6",
			name: "xai/grok-4.6",
			contextWindow: 500_000,
			maxInputTokens: 500_000,
			maxTokens: 64_000,
		})
		expect(config.knownModels?.["openai/grok-4.6"]).toEqual(knownModel)
		getModelsSpy.mockRestore()
	})

	it("keeps an explicit max-input override ahead of cached LiteLLM metadata", async () => {
		const providerId = parseProviderId("litellm")
		const modelId = "openai/grok-4.6"
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "litellm",
			actModeLiteLlmModelId: modelId,
			liteLlmApiKey: "litellm-key",
			actModeLiteLlmModelInfo: {
				name: "xai/grok-4.6",
				contextWindow: 500_000,
				maxInputTokens: 500_000,
				supportsPromptCache: false,
			},
		} as any)
		createProviderConfigStore().commitSelection(providerId, "act", {
			providerId,
			modelId,
			overrides: { maxInputTokens: 300_000 },
		})
		const getModelsSpy = vi.spyOn(LlmsModels, "getModelsForProvider").mockResolvedValueOnce({})

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })
		const knownModel = (config.providerConfig as any).knownModels[modelId]

		expect(knownModel.contextWindow).toBe(500_000)
		expect(knownModel.maxInputTokens).toBe(300_000)
		getModelsSpy.mockRestore()
	})

	it("does not inject fabricated max input metadata for an unknown LiteLLM model", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "litellm",
			actModeLiteLlmModelId: "custom/no-metadata",
			liteLlmApiKey: "litellm-key",
		} as any)
		const getModelsSpy = vi.spyOn(LlmsModels, "getModelsForProvider").mockResolvedValueOnce({})

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.knownModels).toBeUndefined()
		expect(config.providerConfig).not.toHaveProperty("knownModels")
		getModelsSpy.mockRestore()
	})

	it("keeps session creation non-fatal when known-model lookup fails", async () => {
		const lookupError = new Error("registry unavailable")
		const getModelsSpy = vi.spyOn(LlmsModels, "getModelsForProvider").mockRejectedValueOnce(lookupError)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerConfig).not.toHaveProperty("knownModels")
		expect(Logger.warn).toHaveBeenCalledWith(
			"[SessionFactory] Failed to resolve known models for provider=anthropic:",
			lookupError,
		)
		getModelsSpy.mockRestore()
	})

	it("passes OpenAI Compatible max output tokens as an explicit request limit", async () => {
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
				inputPrice: 0,
				outputPrice: 0,
			},
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerId).toBe("openai-compatible")
		expect(config.modelId).toBe("custom-reasoner")
		// knownModels is exposed both inside providerConfig (inference) and at
		// the top level (manual compaction budgets).
		expect(config.knownModels).toBeDefined()
		expect((config.providerConfig as any).knownModels).toBeDefined()
		// Mirrored onto providerConfig for the compaction summarizer (CLINE-2911).
		expect((config.providerConfig as any).maxOutputTokens).toBe(4_096)
		expect((config as any).maxTokensPerTurn).toBe(4_096)
	})

	it("uses OpenAI Compatible overrides from models.json for runtime request settings", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "openai",
			actModeOpenAiModelId: "custom-reasoner",
			openAiApiKey: "openai-compatible-key",
			openAiBaseUrl: "https://openai-compatible.example/v1",
			actModeOpenAiModelInfo: { supportsPromptCache: false },
		} as any)
		createProviderConfigStore().commitSelection(parseProviderId("openai"), "act", {
			providerId: parseProviderId("openai"),
			modelId: "custom-reasoner",
			overrides: {
				name: "Custom Reasoner",
				contextWindow: 16_000,
				maxInputTokens: 15_000,
				maxTokens: 1_234,
				capabilities: ["images", "reasoning", "streaming", "tools"],
				supportsVision: false,
				supportsAttachments: true,
				supportsReasoning: false,
				temperature: 0,
				inputPrice: 1,
				outputPrice: 2,
				cacheReadsPrice: 0.1,
				cacheWritesPrice: 0.5,
				apiFormat: ApiFormat.OPENAI_RESPONSES,
			},
		})

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })
		const knownModel = (config.providerConfig as any).knownModels["custom-reasoner"]

		expect(config.providerId).toBe("openai-compatible")
		expect(config.modelId).toBe("custom-reasoner")
		expect((config as any).maxTokensPerTurn).toBe(1_234)
		expect((config as any).temperature).toBe(0)
		expect(knownModel).toMatchObject({
			id: "custom-reasoner",
			name: "Custom Reasoner",
			contextWindow: 16_000,
			maxInputTokens: 15_000,
			maxTokens: 1_234,
			capabilities: ["streaming", "tools", "files"],
			apiFormat: "openai-responses",
			temperature: 0,
			pricing: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.5 },
		})
	})

	it("defaults tool-calling on for dynamic-list models without preserved SDK capabilities", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "openrouter",
			actModeOpenRouterModelId: "mock/custom-model",
			openRouterApiKey: "openrouter-key",
			// Dynamic-list picker snapshot: legacy boolean flags but no SDK
			// capability list. The reconstructed capabilities array must still
			// carry "tools" — the SDK treats a populated list without it as
			// "cannot call tools" and silently drops every tool from the session
			// (the file-edit e2e regression).
			actModeOpenRouterModelInfo: {
				name: "Mock Custom Model",
				contextWindow: 16_000,
				supportsImages: true,
				supportsPromptCache: true,
				modalities: { input: ["text", "image"], output: ["text", "image"] },
				inputPrice: 0,
				outputPrice: 0,
			},
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })
		const knownModel = (config.providerConfig as any).knownModels["mock/custom-model"]

		expect(knownModel.capabilities).toEqual(expect.arrayContaining(["images", "prompt-cache", "tools"]))
		expect(knownModel.modalities).toEqual({ input: ["text", "image"], output: ["text", "image"] })
	})

	it("defaults tool-calling on when the preserved capability list is defined but empty", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "openrouter",
			actModeOpenRouterModelId: "mock/empty-capabilities-model",
			openRouterApiKey: "openrouter-key",
			// A capabilities field that round-tripped through a boundary
			// defaulting the missing array to [] — same "no signal" state as
			// an absent one (modelHasCapability treats both as unspecified).
			// Before the fix, the strict `=== undefined` guard skipped the
			// tools seeding, supportsReasoning populated the array, and the
			// runtime gate silently dropped every tool definition (#13463).
			actModeOpenRouterModelInfo: {
				name: "Empty Capabilities Model",
				contextWindow: 16_000,
				// Required by the store's isModelInfo gate: without a boolean
				// supportsPromptCache the state snapshot is rejected and the
				// model never reaches knownModels at all.
				supportsPromptCache: false,
				supportsReasoning: true,
				capabilities: [],
			},
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })
		const knownModel = (config.providerConfig as any).knownModels["mock/empty-capabilities-model"]

		expect(knownModel.capabilities).toEqual(expect.arrayContaining(["reasoning", "tools"]))
	})

	it("keeps legacy supportsTools=false authoritative for dynamic-list models", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "openrouter",
			actModeOpenRouterModelId: "mock/no-tools-model",
			openRouterApiKey: "openrouter-key",
			actModeOpenRouterModelInfo: {
				name: "No Tools",
				supportsPromptCache: true,
				supportsTools: false,
			},
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })
		const knownModel = (config.providerConfig as any).knownModels["mock/no-tools-model"]

		expect(knownModel.capabilities).toContain("prompt-cache")
		expect(knownModel.capabilities).not.toContain("tools")
	})

	it("trusts a preserved SDK capability list instead of injecting tools", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "openrouter",
			actModeOpenRouterModelId: "mock/media-model",
			openRouterApiKey: "openrouter-key",
			// A capability list preserved from the SDK catalog boundary is
			// authoritative: when it omits "tools", the session must not
			// re-enable tool calling.
			actModeOpenRouterModelInfo: {
				name: "Media Model",
				supportsPromptCache: false,
				capabilities: ["images"],
			},
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })
		const knownModel = (config.providerConfig as any).knownModels["mock/media-model"]

		expect(knownModel.capabilities).toContain("images")
		expect(knownModel.capabilities).not.toContain("tools")
	})

	it("keeps -1 OpenAI Compatible values out of request settings and fallback knownModels", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "openai",
			actModeOpenAiModelId: "custom-reasoner",
			openAiApiKey: "openai-compatible-key",
			openAiBaseUrl: "https://openai-compatible.example/v1",
			actModeOpenAiModelInfo: { supportsPromptCache: false },
		} as any)
		createProviderConfigStore().commitSelection(parseProviderId("openai"), "act", {
			providerId: parseProviderId("openai"),
			modelId: "custom-reasoner",
			overrides: {
				name: "Custom Reasoner",
				maxTokens: -1,
				temperature: -1,
			},
		})

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect((config as any).maxTokensPerTurn).toBeUndefined()
		expect((config.providerConfig as any).maxOutputTokens).toBeUndefined()
		expect((config as any).temperature).toBeUndefined()
		const knownModel = (config.providerConfig as any).knownModels["custom-reasoner"]
		expect(knownModel).not.toHaveProperty("maxTokens")
		expect(knownModel).not.toHaveProperty("temperature", -1)
	})

	it("passes OCA reasoning effort from legacy mode settings to SDK sessions", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "oca",
			actModeOcaModelId: "oca-reasoner",
			ocaApiKey: "oca-key",
			actModeOcaReasoningEffort: " HIGH ",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerId).toBe("oca")
		expect(config.modelId).toBe("oca-reasoner")
		expect(config.thinking).toBe(true)
		expect(config.reasoningEffort).toBe("high")
	})

	it("lets legacy OCA none override stale provider reasoning settings", async () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue({
			provider: "oca",
			reasoning: { enabled: true, effort: "medium" },
		} as any)
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "oca",
			actModeOcaModelId: "oca-reasoner",
			ocaApiKey: "oca-key",
			actModeOcaReasoningEffort: "none",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.thinking).toBe(false)
		expect(config.reasoningEffort).toBeUndefined()
	})

	it("builds structured SAP AI Core config from legacy ApiConfiguration fields", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "sapaicore",
			actModeApiModelId: "anthropic--claude-4.6-sonnet",
			sapAiCoreClientId: "sap-client",
			sapAiCoreClientSecret: "sap-secret",
			sapAiCoreBaseUrl: " https://api.ai.example.aws.ml.hana.ondemand.com ",
			sapAiCoreTokenUrl: " https://example.authentication.sap.hana.ondemand.com ",
			sapAiResourceGroup: " default ",
			sapAiCoreUseOrchestrationMode: false,
			actModeSapAiCoreDeploymentId: " deployment-id ",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerId).toBe("sapaicore")
		expect(config.modelId).toBe("anthropic--claude-4.6-sonnet")
		expect(config.apiKey).toBe("")
		expect(config.baseUrl).toBe("https://api.ai.example.aws.ml.hana.ondemand.com")
		expect(config.providerConfig).toMatchObject({
			providerId: "sapaicore",
			modelId: "anthropic--claude-4.6-sonnet",
			baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
			sap: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://example.authentication.sap.hana.ondemand.com",
				resourceGroup: "default",
				deploymentId: "deployment-id",
				useOrchestrationMode: false,
			},
		})
		expect(config.providerConfig).not.toHaveProperty("apiKey")
	})

	it("defaults SAP AI Core to orchestration mode and omits deployment id when mode is unset", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "sapaicore",
			actModeApiModelId: "anthropic--claude-4.6-sonnet",
			sapAiCoreClientId: "sap-client",
			sapAiCoreClientSecret: "sap-secret",
			sapAiCoreBaseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
			sapAiCoreTokenUrl: "https://example.authentication.sap.hana.ondemand.com",
			sapAiResourceGroup: "default",
			actModeSapAiCoreDeploymentId: "foundation-deployment-id",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerConfig).toMatchObject({
			providerId: "sapaicore",
			sap: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://example.authentication.sap.hana.ondemand.com",
				resourceGroup: "default",
				useOrchestrationMode: true,
			},
		})
		expect((config.providerConfig as any).sap).not.toHaveProperty("deploymentId")
	})

	it("omits SAP AI Core deployment id when orchestration mode is enabled", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "sapaicore",
			actModeApiModelId: "anthropic--claude-4.6-sonnet",
			sapAiCoreClientId: "sap-client",
			sapAiCoreClientSecret: "sap-secret",
			sapAiCoreBaseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
			sapAiCoreTokenUrl: "https://example.authentication.sap.hana.ondemand.com",
			sapAiResourceGroup: "default",
			sapAiCoreUseOrchestrationMode: true,
			actModeSapAiCoreDeploymentId: "foundation-deployment-id",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect((config.providerConfig as any).sap).toMatchObject({
			resourceGroup: "default",
			useOrchestrationMode: true,
		})
		expect((config.providerConfig as any).sap).not.toHaveProperty("deploymentId")
	})

	it("falls back to legacy SAP-specific model fields when the generic model field is absent", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "sapaicore",
			actModeSapAiCoreModelId: "anthropic--claude-3.5-sonnet",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerId).toBe("sapaicore")
		expect(config.modelId).toBe("anthropic--claude-3.5-sonnet")
	})

	it("preserves an explicitly cleared SAP base URL so stored settings cannot fill it back in", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "sapaicore",
			actModeApiModelId: "anthropic--claude-4.6-sonnet",
			sapAiCoreBaseUrl: "   ",
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.baseUrl).toBe("")
		expect(config.providerConfig).toMatchObject({
			providerId: "sapaicore",
			baseUrl: "",
		})
		expect(config.providerConfig).not.toHaveProperty("sap")
	})

	it("does not emit partial SAP overrides when SAP strings are absent", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "sapaicore",
			actModeApiModelId: "anthropic--claude-4.6-sonnet",
			sapAiCoreUseOrchestrationMode: false,
		} as any)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerConfig).toMatchObject({
			providerId: "sapaicore",
		})
		expect(config.providerConfig).not.toHaveProperty("baseUrl")
		expect(config.providerConfig).not.toHaveProperty("sap")
	})

	it("uses ClinePass model storage and omits empty nested apiKey so SDK OAuth can fill it", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "cline-pass",
			actModeClinePassModelId: "cline-pass/glm-5.2",
		} as any)
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(config.providerId).toBe("cline-pass")
		expect(config.modelId).toBe("cline-pass/glm-5.2")
		expect(config.apiKey).toBe("")
		expect(config.providerConfig).toMatchObject({ providerId: "cline-pass", modelId: "cline-pass/glm-5.2" })
		expect(config.providerConfig).not.toHaveProperty("apiKey")
	})

	it("enables agentic SDK compaction when global useAutoCondense is true", async () => {
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
			strategy: "agentic",
		})
	})

	it("uses the configured SDK compaction strategy when auto condense is enabled", async () => {
		writeJson(process.env.CLINE_GLOBAL_SETTINGS_PATH!, { compactionStrategy: "basic" })
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

	it("falls back to agentic SDK compaction for an invalid stored strategy", async () => {
		writeJson(process.env.CLINE_GLOBAL_SETTINGS_PATH!, { compactionStrategy: "invalid" })
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
			strategy: "agentic",
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
			strategy: "agentic",
		})
	})

	it("emits the shared mode-tag instructions in both act and plan system prompts", async () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({} as any)

		const actConfig = await buildSessionConfig({ cwd: "/tmp/workspace", mode: "act" })
		const planConfig = await buildSessionConfig({ cwd: "/tmp/workspace", mode: "plan" })

		// The shared prompt builder now owns the mode semantics: the
		// <user_input mode> / <mode_notice> explanation goes to both modes, the
		// plan-mode contract (read-only run_commands included) only to plan.
		expect(actConfig.systemPrompt).toContain("# Plan / Act Modes")
		expect(actConfig.systemPrompt).toContain("<mode_notice>")
		expect(actConfig.systemPrompt).not.toContain("# Plan Mode\n")

		expect(planConfig.systemPrompt).toContain("# Plan / Act Modes")
		expect(planConfig.systemPrompt).toContain("# Plan Mode\n")
		expect(planConfig.systemPrompt).toContain(
			"run_commands tool remains available in plan mode strictly for read-only inspection",
		)
		// Unlike the CLI, the extension never exposes switch_to_act_mode: the
		// plan contract must direct the model to the manual Plan/Act toggle
		// instead of a tool it does not have.
		expect(planConfig.systemPrompt).not.toContain("switch_to_act_mode")
		expect(planConfig.systemPrompt).toContain("Plan/Act toggle")
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
