import type { ApiConfiguration } from "@shared/api"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { hasUsableProvider, hasUsableProviderForActiveMode } from "./provider-usability"

const mocks = vi.hoisted(() => {
	const providerSettingsManager = {
		getProviderSettings: vi.fn(() => undefined as unknown),
		getLastUsedProviderSettings: vi.fn(() => undefined as unknown),
		saveProviderSettings: vi.fn(),
	}
	return {
		providerSettingsManager,
		getProviderSettingsManager: vi.fn(() => providerSettingsManager),
		stateManager: {
			getApiConfiguration: vi.fn((): ApiConfiguration => ({})),
			getGlobalSettingsKey: vi.fn((_key: string): unknown => undefined),
		},
	}
})

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => mocks.stateManager,
	},
}))

vi.mock("./provider-migration", () => ({
	getProviderSettingsManager: mocks.getProviderSettingsManager,
}))

vi.mock("@shared/services/Logger", () => ({
	Logger: {
		log: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

beforeEach(() => {
	mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)
})

afterEach(() => {
	vi.clearAllMocks()
})

describe("hasUsableProvider", () => {
	it("returns false when no provider is set for the active mode", () => {
		expect(hasUsableProvider({}, "act")).toBe(false)
		expect(hasUsableProvider({}, "plan")).toBe(false)
	})

	it("returns true for a BYOK provider with an API key (act mode)", () => {
		const config: ApiConfiguration = {
			actModeApiProvider: "openrouter",
			openRouterApiKey: "sk-or-123",
		}
		expect(hasUsableProvider(config, "act")).toBe(true)
	})

	it("returns false for a BYOK provider with no API key", () => {
		const config: ApiConfiguration = {
			actModeApiProvider: "openrouter",
		}
		expect(hasUsableProvider(config, "act")).toBe(false)
	})

	it("returns false for a BYOK provider whose key is only whitespace", () => {
		const config: ApiConfiguration = {
			actModeApiProvider: "anthropic",
			apiKey: "   ",
		}
		expect(hasUsableProvider(config, "act")).toBe(false)
	})

	it("resolves the provider for the active mode independently (plan vs act)", () => {
		const config: ApiConfiguration = {
			actModeApiProvider: "anthropic",
			apiKey: "sk-ant-123",
			planModeApiProvider: "openrouter",
			// no openRouterApiKey -> plan is not usable
		}
		expect(hasUsableProvider(config, "act")).toBe(true)
		expect(hasUsableProvider(config, "plan")).toBe(false)
	})

	it("treats the cline provider as usable when a token is present in providers.json", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue({
			provider: "cline",
			auth: { accessToken: "workos:abc123" },
		})
		const config: ApiConfiguration = { actModeApiProvider: "cline" }
		expect(hasUsableProvider(config, "act")).toBe(true)
	})

	it("treats the cline provider as NOT usable when no token and no model is present", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)
		const config: ApiConfiguration = { actModeApiProvider: "cline" }
		// cline is keyless (oauth), but with no token AND no model -> not usable
		expect(hasUsableProvider(config, "act")).toBe(false)
	})

	it("treats the cline provider as NOT usable when a model is configured but there is no token", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)
		const config: ApiConfiguration = {
			actModeApiProvider: "cline",
			actModeClineModelId: "anthropic/claude-sonnet-4.6",
		}
		// This is the core case of scenario #3: an unauthenticated Cline user
		// (the default provider, which always has a model preselected) must be
		// gated. A configured model alone must NOT make an OAuth provider usable.
		expect(hasUsableProvider(config, "act")).toBe(false)
	})

	it("treats OpenAI Codex as usable when ChatGPT subscription OAuth credentials are present", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue({
			provider: "openai-codex",
			auth: { accessToken: "codex-access", refreshToken: "codex-refresh" },
		})
		const config: ApiConfiguration = {
			actModeApiProvider: "openai-codex",
			actModeApiModelId: "gpt-5.4",
		}
		expect(hasUsableProvider(config, "act")).toBe(true)
	})

	it("treats OpenAI Codex as NOT usable when a model is configured but no OAuth credentials are present", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)
		const config: ApiConfiguration = {
			actModeApiProvider: "openai-codex",
			actModeApiModelId: "gpt-5.4",
		}
		expect(hasUsableProvider(config, "act")).toBe(false)
	})

	it("treats ollama (keyless local) as usable when a model is configured, without a key", () => {
		const config: ApiConfiguration = {
			actModeApiProvider: "ollama",
			actModeOllamaModelId: "llama3",
		}
		expect(hasUsableProvider(config, "act")).toBe(true)
	})

	it("treats ollama (keyless local) as NOT usable when no model is configured", () => {
		const config: ApiConfiguration = {
			actModeApiProvider: "ollama",
		}
		expect(hasUsableProvider(config, "act")).toBe(false)
	})

	it("treats lmstudio (keyless local) as usable when a model is configured", () => {
		const config: ApiConfiguration = {
			actModeApiProvider: "lmstudio",
			actModeLmStudioModelId: "local-model",
		}
		expect(hasUsableProvider(config, "act")).toBe(true)
	})
})

describe("hasUsableProviderForActiveMode", () => {
	it("reads ApiConfiguration + mode from StateManager and returns true for a usable BYOK config", () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "openrouter",
			openRouterApiKey: "sk-or-xyz",
		})
		mocks.stateManager.getGlobalSettingsKey.mockImplementation((key: string) => (key === "mode" ? "act" : undefined))
		expect(hasUsableProviderForActiveMode()).toBe(true)
	})

	it("returns false when StateManager has no provider configured", () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({})
		mocks.stateManager.getGlobalSettingsKey.mockImplementation((key: string) => (key === "mode" ? "act" : undefined))
		expect(hasUsableProviderForActiveMode()).toBe(false)
	})

	it("defaults mode to act when StateManager returns no mode", () => {
		mocks.stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "anthropic",
			apiKey: "sk-ant",
		})
		mocks.stateManager.getGlobalSettingsKey.mockReturnValue(undefined)
		expect(hasUsableProviderForActiveMode()).toBe(true)
	})

	it("fails open (returns true) when StateManager throws", () => {
		mocks.stateManager.getApiConfiguration.mockImplementation(() => {
			throw new Error("boom")
		})
		expect(hasUsableProviderForActiveMode()).toBe(true)
	})
})
