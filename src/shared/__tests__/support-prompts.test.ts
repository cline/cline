import { codeActionPrompt, type CodeActionType } from "../support-prompt"

describe("Code Action Prompts", () => {
	const testFilePath = "test/file.ts"
	const testCode = "function test() { return true; }"

	describe("EXPLAIN action", () => {
		it("should format explain prompt correctly", () => {
			const prompt = codeActionPrompt.create("EXPLAIN", {
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
			const prompt = codeActionPrompt.create("FIX", {
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

			const prompt = codeActionPrompt.create("FIX", {
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
			const prompt = codeActionPrompt.create("IMPROVE", {
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

	describe("get template", () => {
		it("should return default template when no custom prompts provided", () => {
			const template = codeActionPrompt.get(undefined, "EXPLAIN")
			expect(template).toBe(codeActionPrompt.default.EXPLAIN)
		})

		it("should return custom template when provided", () => {
			const customTemplate = "Custom template for explaining code"
			const customPrompts = {
				EXPLAIN: customTemplate,
			}
			const template = codeActionPrompt.get(customPrompts, "EXPLAIN")
			expect(template).toBe(customTemplate)
		})

		it("should return default template when custom prompts does not include type", () => {
			const customPrompts = {
				SOMETHING_ELSE: "Other template",
			}
			const template = codeActionPrompt.get(customPrompts, "EXPLAIN")
			expect(template).toBe(codeActionPrompt.default.EXPLAIN)
		})
	})

	describe("create with custom prompts", () => {
		it("should use custom template when provided", () => {
			const customTemplate = "Custom template for ${filePath}"
			const customPrompts = {
				EXPLAIN: customTemplate,
			}

			const prompt = codeActionPrompt.create(
				"EXPLAIN",
				{
					filePath: testFilePath,
					selectedText: testCode,
				},
				customPrompts,
			)

			expect(prompt).toContain(`Custom template for ${testFilePath}`)
			expect(prompt).not.toContain("purpose and functionality")
		})

		it("should use default template when custom prompts does not include type", () => {
			const customPrompts = {
				EXPLAIN: "Other template",
			}

			const prompt = codeActionPrompt.create(
				"EXPLAIN",
				{
					filePath: testFilePath,
					selectedText: testCode,
				},
				customPrompts,
			)

			expect(prompt).toContain("Other template")
		})
	})
})
