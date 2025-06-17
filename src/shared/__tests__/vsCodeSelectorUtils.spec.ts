import { LanguageModelChatSelector } from "vscode"

import { stringifyVsCodeLmModelSelector } from "../vsCodeSelectorUtils"

describe("vsCodeSelectorUtils", () => {
	describe("stringifyVsCodeLmModelSelector", () => {
		it("should join all defined selector properties with separator", () => {
			const selector: LanguageModelChatSelector = {
				vendor: "test-vendor",
				family: "test-family",
				version: "v1",
				id: "test-id",
			}

			const result = stringifyVsCodeLmModelSelector(selector)
			expect(result).toBe("test-vendor/test-family/v1/test-id")
		})

		it("should skip undefined properties", () => {
			const selector: LanguageModelChatSelector = {
				vendor: "test-vendor",
				family: "test-family",
			}

			const result = stringifyVsCodeLmModelSelector(selector)
			expect(result).toBe("test-vendor/test-family")
		})

		it("should handle empty selector", () => {
			const selector: LanguageModelChatSelector = {}

			const result = stringifyVsCodeLmModelSelector(selector)
			expect(result).toBe("")
		})

		it("should handle selector with only one property", () => {
			const selector: LanguageModelChatSelector = {
				vendor: "test-vendor",
			}

			const result = stringifyVsCodeLmModelSelector(selector)
			expect(result).toBe("test-vendor")
		})
	})
})
