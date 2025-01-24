import { isToolAllowedForMode, FileRestrictionError, ModeConfig } from "../modes"

describe("isToolAllowedForMode", () => {
	const customModes: ModeConfig[] = [
		{
			slug: "markdown-editor",
			name: "Markdown Editor",
			roleDefinition: "You are a markdown editor",
			groups: ["read", ["edit", { fileRegex: "\\.md$" }], "browser"],
		},
		{
			slug: "css-editor",
			name: "CSS Editor",
			roleDefinition: "You are a CSS editor",
			groups: ["read", ["edit", { fileRegex: "\\.css$" }], "browser"],
		},
	]

	it("allows always available tools", () => {
		expect(isToolAllowedForMode("ask_followup_question", "markdown-editor", customModes)).toBe(true)
		expect(isToolAllowedForMode("attempt_completion", "markdown-editor", customModes)).toBe(true)
	})

	it("allows unrestricted tools", () => {
		expect(isToolAllowedForMode("read_file", "markdown-editor", customModes)).toBe(true)
		expect(isToolAllowedForMode("browser_action", "markdown-editor", customModes)).toBe(true)
	})

	describe("file restrictions", () => {
		it("allows editing matching files", () => {
			// Test markdown editor mode
			const mdResult = isToolAllowedForMode("write_to_file", "markdown-editor", customModes, undefined, "test.md")
			expect(mdResult).toBe(true)

			// Test CSS editor mode
			const cssResult = isToolAllowedForMode("write_to_file", "css-editor", customModes, undefined, "styles.css")
			expect(cssResult).toBe(true)
		})

		it("rejects editing non-matching files", () => {
			// Test markdown editor mode with non-markdown file
			const mdError = isToolAllowedForMode("write_to_file", "markdown-editor", customModes, undefined, "test.js")
			expect(mdError).toBeInstanceOf(FileRestrictionError)
			expect((mdError as FileRestrictionError).message).toContain("\\.md$")

			// Test CSS editor mode with non-CSS file
			const cssError = isToolAllowedForMode("write_to_file", "css-editor", customModes, undefined, "test.js")
			expect(cssError).toBeInstanceOf(FileRestrictionError)
			expect((cssError as FileRestrictionError).message).toContain("\\.css$")
		})

		it("requires file path for restricted edit operations", () => {
			const result = isToolAllowedForMode("write_to_file", "markdown-editor", customModes)
			expect(result).toBeInstanceOf(FileRestrictionError)
			expect((result as FileRestrictionError).message).toContain("\\.md$")
		})

		it("applies restrictions to both write_to_file and apply_diff", () => {
			// Test write_to_file
			const writeResult = isToolAllowedForMode(
				"write_to_file",
				"markdown-editor",
				customModes,
				undefined,
				"test.md",
			)
			expect(writeResult).toBe(true)

			// Test apply_diff
			const diffResult = isToolAllowedForMode("apply_diff", "markdown-editor", customModes, undefined, "test.md")
			expect(diffResult).toBe(true)

			// Test both with non-matching file
			const writeError = isToolAllowedForMode(
				"write_to_file",
				"markdown-editor",
				customModes,
				undefined,
				"test.js",
			)
			expect(writeError).toBeInstanceOf(FileRestrictionError)

			const diffError = isToolAllowedForMode("apply_diff", "markdown-editor", customModes, undefined, "test.js")
			expect(diffError).toBeInstanceOf(FileRestrictionError)
		})
	})

	it("handles non-existent modes", () => {
		expect(isToolAllowedForMode("write_to_file", "non-existent", customModes)).toBe(false)
	})

	it("respects tool requirements", () => {
		const toolRequirements = {
			write_to_file: false,
		}

		expect(isToolAllowedForMode("write_to_file", "markdown-editor", customModes, toolRequirements)).toBe(false)
	})
})

describe("FileRestrictionError", () => {
	it("formats error message correctly", () => {
		const error = new FileRestrictionError("Markdown Editor", "\\.md$")
		expect(error.message).toBe("This mode (Markdown Editor) can only edit files matching the pattern: \\.md$")
		expect(error.name).toBe("FileRestrictionError")
	})
})
