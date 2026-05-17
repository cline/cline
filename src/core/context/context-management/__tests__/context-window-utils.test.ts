import { expect } from "chai"
import { getContextWindowInfo } from "../context-window-utils"

function createMockApi(modelId: string, contextWindow?: number) {
	return {
		getModel: () => ({ id: modelId, info: { contextWindow } }),
	} as any
}

describe("getContextWindowInfo", () => {
	it("preserves configured context window for OpenAI-compatible DeepSeek models", () => {
		const result = getContextWindowInfo(createMockApi("deepseek/deepseek-v4-pro", 1_000_000))

		expect(result.contextWindow).to.equal(1_000_000)
		expect(result.maxAllowedSize).to.equal(960_000)
	})

	it("uses the default context window when a model omits one", () => {
		const result = getContextWindowInfo(createMockApi("custom-model"))

		expect(result.contextWindow).to.equal(128_000)
		expect(result.maxAllowedSize).to.equal(98_000)
	})
})
