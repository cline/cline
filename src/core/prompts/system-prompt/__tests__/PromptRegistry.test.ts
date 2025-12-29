import { expect } from "chai"
import type { McpHub } from "@/services/mcp/McpHub"
import { ModelFamily } from "@/shared/prompts"
import { PromptRegistry } from "../registry/PromptRegistry"
import type { SystemPromptContext } from "../types"
import { mockProviderInfo } from "./integration.test"

describe("PromptRegistry", () => {
	let registry: PromptRegistry
	const mockContext: SystemPromptContext = {
		cwd: "/test/project",
		ide: "TestIde",
		supportsBrowserUse: true,
		mcpHub: {
			getServers: () => [],
			getMcpServersPath: () => "/test/mcp-servers",
			getSettingsDirectoryPath: () => "/test/settings",
			clientVersion: "1.0.0",
			disposables: [],
		} as unknown as McpHub,
		focusChainSettings: {
			enabled: true,
			remindClineInterval: 6,
		},
		browserSettings: {
			viewport: {
				width: 1280,
				height: 720,
			},
		},
		isTesting: true,
		providerInfo: mockProviderInfo,
	}

	beforeEach(() => {
		// Get a fresh instance for each test
		PromptRegistry.dispose()
		registry = PromptRegistry.getInstance()
	})

	describe("getInstance", () => {
		it("should return singleton instance", () => {
			const instance1 = PromptRegistry.getInstance()
			const instance2 = PromptRegistry.getInstance()

			expect(instance1).to.equal(instance2)
		})
	})

	describe("getModelFamily", () => {
		it("should extract correct model families", async () => {
			const registry = PromptRegistry.getInstance()
			await registry.load()
			const testCases = [
				{ id: "claude-3-5-sonnet", expected: ModelFamily.GENERIC },
				{ id: "gpt-4-turbo", expected: ModelFamily.GENERIC },
				{ id: "gemini-pro", expected: ModelFamily.GENERIC },
				{ id: "qwen-max", provider: "lmstudio", expected: ModelFamily.XS },
				{ id: "anthropic/claude-3", expected: ModelFamily.GENERIC },
				{ id: "openai/gpt-4", expected: ModelFamily.GENERIC },
				{ id: "google/gemini", expected: ModelFamily.GENERIC },
				{ id: "claude-sonnet-4", expected: ModelFamily.NEXT_GEN },
				{ id: "gpt-5", provider: "cline", expected: ModelFamily.NATIVE_GPT_5, useNativeTools: true },
				{ id: "gpt-5", provider: "openai-native", expected: ModelFamily.NATIVE_GPT_5, useNativeTools: true },
				{ id: "gpt-5", provider: "cline", expected: ModelFamily.GPT_5, useNativeTools: false },
				{ id: "gpt-5-1", provider: "openai-native", expected: ModelFamily.NATIVE_GPT_5_1, useNativeTools: true },
				{ id: "openai/gpt-5", expected: ModelFamily.NEXT_GEN },
				{ id: "gemini3", provider: "vertex", expected: ModelFamily.GEMINI_3, useNativeTools: true },
				{ id: "unknown-model", expected: ModelFamily.GENERIC },
			]

			for (const { id, expected, provider, useNativeTools } of testCases) {
				const providerId = provider ?? "random"
				const customPrompt = provider === "lmstudio" ? "compact" : undefined
				const providerInfo = { ...mockProviderInfo, providerId, model: { ...mockProviderInfo.model, id }, customPrompt }
				const result = registry.getModelFamily({
					...mockContext,
					providerInfo,
					enableNativeToolCalls: useNativeTools ?? false,
				})
				expect(result).to.equal(expected, `Failed for model ${id} with provider ${providerId}`)
			}
		})
	})

	describe("get method", () => {
		it("should handle fallback to generic variant", async () => {
			try {
				// Try to get a prompt for an unknown model
				// This should fallback to generic or throw an appropriate error
				const prompt = await registry.get(mockContext)

				// If we get a prompt, it should be a string
				expect(prompt).to.be.a("string")
				if (prompt.length > 0) {
					expect(prompt.length).to.be.greaterThan(10)
				}
			} catch (error) {
				// It's okay if it throws an error about missing variants
				expect(error).to.be.instanceOf(Error)
			}
		})
	})

	describe("getAvailableModels", () => {
		it("should return list of available model IDs", () => {
			const models = registry.getAvailableModels()
			expect(models).to.be.an("array")
			// Should be empty initially since no variants are loaded
			expect(models.length).to.be.greaterThanOrEqual(0)
		})
	})

	describe("registerComponent", () => {
		it("should register custom components", () => {
			const mockComponent = async () => "CUSTOM COMPONENT"

			registry.registerComponent("custom", mockComponent)

			expect((registry as any).components.custom).to.equal(mockComponent)
		})
	})

	describe("basic functionality", () => {
		it("should be able to create registry instance", () => {
			expect(registry).to.be.instanceOf(PromptRegistry)
		})

		it("should have required methods", () => {
			expect(registry.get).to.be.a("function")
			expect(registry.getVersion).to.be.a("function")
			expect(registry.getByTag).to.be.a("function")
			expect(registry.registerComponent).to.be.a("function")
			expect(registry.getAvailableModels).to.be.a("function")
		})
	})
})
