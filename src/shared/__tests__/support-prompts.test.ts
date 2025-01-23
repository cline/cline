import { supportPrompt } from "../support-prompt"

describe("Code Action Prompts", () => {
	const testFilePath = "test/file.ts"
	const testCode = "function test() { return true; }"

	describe("EXPLAIN action", () => {
		it("should format explain prompt correctly", () => {
			const prompt = supportPrompt.create("EXPLAIN", {
				filePath: testFilePath,
				selectedText: testCode,
			})

			expect(prompt).toContain(`@/${testFilePath}`)
			expect(prompt).toContain(testCode)
			expect(prompt).toContain("purpose and functionality")
			expect(prompt).toContain("Key components")
			expect(prompt).toContain("Important patterns")
		})
	})

	describe("FIX action", () => {
		it("should format fix prompt without diagnostics", () => {
			const prompt = supportPrompt.create("FIX", {
				filePath: testFilePath,
				selectedText: testCode,
			})

			expect(prompt).toContain(`@/${testFilePath}`)
			expect(prompt).toContain(testCode)
			expect(prompt).toContain("Address all detected problems")
			expect(prompt).not.toContain("Current problems detected")
		})

		it("should format fix prompt with diagnostics", () => {
			const diagnostics = [
				{
					source: "eslint",
					message: "Missing semicolon",
					code: "semi",
				},
				{
					message: "Unused variable",
					severity: 1,
				},
			]

			const prompt = supportPrompt.create("FIX", {
				filePath: testFilePath,
				selectedText: testCode,
				diagnostics,
			})

			expect(prompt).toContain("Current problems detected:")
			expect(prompt).toContain("[eslint] Missing semicolon (semi)")
			expect(prompt).toContain("[Error] Unused variable")
			expect(prompt).toContain(testCode)
		})
	})

	describe("IMPROVE action", () => {
		it("should format improve prompt correctly", () => {
			const prompt = supportPrompt.create("IMPROVE", {
				filePath: testFilePath,
				selectedText: testCode,
			})

			expect(prompt).toContain(`@/${testFilePath}`)
			expect(prompt).toContain(testCode)
			expect(prompt).toContain("Code readability")
			expect(prompt).toContain("Performance optimization")
			expect(prompt).toContain("Best practices")
			expect(prompt).toContain("Error handling")
		})
	})

	describe("ENHANCE action", () => {
		it("should format enhance prompt correctly", () => {
			const prompt = supportPrompt.create("ENHANCE", {
				userInput: "test",
			})

			expect(prompt).toBe(
				"Generate an enhanced version of this prompt (reply with only the enhanced prompt - no conversation, explanations, lead-in, bullet points, placeholders, or surrounding quotes):\n\ntest",
			)
			// Verify it ignores parameters since ENHANCE template doesn't use any
			expect(prompt).not.toContain(testFilePath)
			expect(prompt).not.toContain(testCode)
		})
	})

	describe("get template", () => {
		it("should return default template when no custom prompts provided", () => {
			const template = supportPrompt.get(undefined, "EXPLAIN")
			expect(template).toBe(supportPrompt.default.EXPLAIN)
		})

		it("should return custom template when provided", () => {
			const customTemplate = "Custom template for explaining code"
			const customSupportPrompts = {
				EXPLAIN: customTemplate,
			}
			const template = supportPrompt.get(customSupportPrompts, "EXPLAIN")
			expect(template).toBe(customTemplate)
		})

		it("should return default template when custom prompts does not include type", () => {
			const customSupportPrompts = {
				SOMETHING_ELSE: "Other template",
			}
			const template = supportPrompt.get(customSupportPrompts, "EXPLAIN")
			expect(template).toBe(supportPrompt.default.EXPLAIN)
		})
	})

	describe("create with custom prompts", () => {
		it("should use custom template when provided", () => {
			const customTemplate = "Custom template for ${filePath}"
			const customSupportPrompts = {
				EXPLAIN: customTemplate,
			}

			const prompt = supportPrompt.create(
				"EXPLAIN",
				{
					filePath: testFilePath,
					selectedText: testCode,
				},
				customSupportPrompts,
			)

			expect(prompt).toContain(`Custom template for ${testFilePath}`)
			expect(prompt).not.toContain("purpose and functionality")
		})

		it("should use default template when custom prompts does not include type", () => {
			const customSupportPrompts = {
				EXPLAIN: "Other template",
			}

			const prompt = supportPrompt.create(
				"EXPLAIN",
				{
					filePath: testFilePath,
					selectedText: testCode,
				},
				customSupportPrompts,
			)

			expect(prompt).toContain("Other template")
		})
	})
})
