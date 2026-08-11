import type { ModelInfo } from "@shared/api"
import { describe, expect, it, vi } from "vitest"
import { applyHostModelInfoOverrides } from "./host-overrides"
import { parseProviderId } from "./provider-id"

// The Ollama override path reads persisted settings; the Vertex paths under
// test never touch either dependency.
vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => {
			throw new Error("unavailable in tests")
		},
	},
}))
vi.mock("../provider-migration", () => ({
	getProviderSettingsManager: () => {
		throw new Error("unavailable in tests")
	},
}))

describe("applyHostModelInfoOverrides — vertex unknown pricing", () => {
	const vertex = parseProviderId("vertex")

	it("drops the $0/$0 pair the adapter substitutes for records without pricing", () => {
		// Vertex has no free models: 0/0 always means the SDK record carried
		// no pricing (e.g. region-dependent billing) and must not render as
		// "Free" in the settings UI.
		const modelInfo: ModelInfo = {
			name: "claude-fable-5",
			contextWindow: 1_000_000,
			maxTokens: 128_000,
			supportsPromptCache: true,
			inputPrice: 0,
			outputPrice: 0,
		}

		const result = applyHostModelInfoOverrides(vertex, "claude-fable-5", modelInfo)

		expect(result.inputPrice).toBeUndefined()
		expect(result.outputPrice).toBeUndefined()
		expect(result.contextWindow).toBe(1_000_000)
		expect(result.maxTokens).toBe(128_000)
		expect(result.supportsPromptCache).toBe(true)
	})

	it("keeps real Vertex pricing untouched", () => {
		const modelInfo: ModelInfo = {
			name: "claude-opus-5@default",
			contextWindow: 1_000_000,
			supportsPromptCache: true,
			inputPrice: 5,
			outputPrice: 25,
		}

		const result = applyHostModelInfoOverrides(vertex, "claude-opus-5@default", modelInfo)

		expect(result.inputPrice).toBe(5)
		expect(result.outputPrice).toBe(25)
	})

	it("composes with the global-endpoint capability override", () => {
		const modelInfo: ModelInfo = {
			name: "claude-sonnet-4-5@20250929",
			supportsPromptCache: true,
			inputPrice: 0,
			outputPrice: 0,
		}

		const result = applyHostModelInfoOverrides(vertex, "claude-sonnet-4-5@20250929", modelInfo)

		expect(result.supportsGlobalEndpoint).toBe(true)
		expect(result.inputPrice).toBeUndefined()
		expect(result.outputPrice).toBeUndefined()
	})

	it("does not touch other providers' zero prices", () => {
		const modelInfo: ModelInfo = {
			name: "some-free-model",
			supportsPromptCache: false,
			inputPrice: 0,
			outputPrice: 0,
		}

		const result = applyHostModelInfoOverrides(parseProviderId("openrouter"), "some-free-model", modelInfo)

		expect(result).toBe(modelInfo)
		expect(result.inputPrice).toBe(0)
		expect(result.outputPrice).toBe(0)
	})
})
