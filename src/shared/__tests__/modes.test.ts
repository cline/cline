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
			const mdResult = isToolAllowedForMode("write_to_file", "markdown-editor", customModes, undefined, {
				path: "test.md",
			})
			expect(mdResult).toBe(true)

			// Test CSS editor mode
			const cssResult = isToolAllowedForMode("write_to_file", "css-editor", customModes, undefined, {
				path: "styles.css",
			})
			expect(cssResult).toBe(true)
		})

		it("rejects editing non-matching files", () => {
			// Test markdown editor mode with non-markdown file
			expect(() =>
				isToolAllowedForMode("write_to_file", "markdown-editor", customModes, undefined, { path: "test.js" }),
			).toThrow(FileRestrictionError)
			expect(() =>
				isToolAllowedForMode("write_to_file", "markdown-editor", customModes, undefined, { path: "test.js" }),
			).toThrow(/\\.md\$/)

			// Test CSS editor mode with non-CSS file
			expect(() =>
				isToolAllowedForMode("write_to_file", "css-editor", customModes, undefined, { path: "test.js" }),
			).toThrow(FileRestrictionError)
			expect(() =>
				isToolAllowedForMode("write_to_file", "css-editor", customModes, undefined, { path: "test.js" }),
			).toThrow(/\\.css\$/)
		})

		it("applies restrictions to both write_to_file and apply_diff", () => {
			// Test write_to_file
			const writeResult = isToolAllowedForMode("write_to_file", "markdown-editor", customModes, undefined, {
				path: "test.md",
			})
			expect(writeResult).toBe(true)

			// Test apply_diff
			const diffResult = isToolAllowedForMode("apply_diff", "markdown-editor", customModes, undefined, {
				path: "test.md",
			})
			expect(diffResult).toBe(true)

			// Test both with non-matching file
			expect(() =>
				isToolAllowedForMode("write_to_file", "markdown-editor", customModes, undefined, { path: "test.js" }),
			).toThrow(FileRestrictionError)

			expect(() =>
				isToolAllowedForMode("apply_diff", "markdown-editor", customModes, undefined, { path: "test.js" }),
			).toThrow(FileRestrictionError)
		})

		it("uses description in file restriction error for custom modes", () => {
			const customModesWithDescription: ModeConfig[] = [
				{
					slug: "docs-editor",
					name: "Documentation Editor",
					roleDefinition: "You are a documentation editor",
					groups: [
						"read",
						["edit", { fileRegex: "\\.(md|txt)$", description: "Documentation files only" }],
						"browser",
					],
				},
			]

			// Test write_to_file with non-matching file
			expect(() =>
				isToolAllowedForMode("write_to_file", "docs-editor", customModesWithDescription, undefined, {
					path: "test.js",
				}),
			).toThrow(FileRestrictionError)
			expect(() =>
				isToolAllowedForMode("write_to_file", "docs-editor", customModesWithDescription, undefined, {
					path: "test.js",
				}),
			).toThrow(/Documentation files only/)

			// Test apply_diff with non-matching file
			expect(() =>
				isToolAllowedForMode("apply_diff", "docs-editor", customModesWithDescription, undefined, {
					path: "test.js",
				}),
			).toThrow(FileRestrictionError)
			expect(() =>
				isToolAllowedForMode("apply_diff", "docs-editor", customModesWithDescription, undefined, {
					path: "test.js",
				}),
			).toThrow(/Documentation files only/)

			// Test that matching files are allowed
			expect(
				isToolAllowedForMode("write_to_file", "docs-editor", customModesWithDescription, undefined, {
					path: "test.md",
				}),
			).toBe(true)

			expect(
				isToolAllowedForMode("write_to_file", "docs-editor", customModesWithDescription, undefined, {
					path: "test.txt",
				}),
			).toBe(true)
		})

		it("allows ask mode to edit markdown files only", () => {
			// Should allow editing markdown files
			expect(isToolAllowedForMode("write_to_file", "ask", [], undefined, { path: "test.md" })).toBe(true)

			// Should allow applying diffs to markdown files
			expect(isToolAllowedForMode("apply_diff", "ask", [], undefined, { path: "readme.md" })).toBe(true)

			// Should reject non-markdown files
			expect(() => isToolAllowedForMode("write_to_file", "ask", [], undefined, { path: "test.js" })).toThrow(
				FileRestrictionError,
			)
			expect(() => isToolAllowedForMode("write_to_file", "ask", [], undefined, { path: "test.js" })).toThrow(
				/Markdown files only/,
			)

			// Should maintain read capabilities
			expect(isToolAllowedForMode("read_file", "ask", [])).toBe(true)
			expect(isToolAllowedForMode("browser_action", "ask", [])).toBe(true)
			expect(isToolAllowedForMode("use_mcp_tool", "ask", [])).toBe(true)
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
	it("formats error message with pattern when no description provided", () => {
		const error = new FileRestrictionError("Markdown Editor", "\\.md$", undefined, "test.js")
		expect(error.message).toBe(
			"This mode (Markdown Editor) can only edit files matching pattern: \\.md$. Got: test.js",
		)
		expect(error.name).toBe("FileRestrictionError")
	})

	it("formats error message with description when provided", () => {
		const error = new FileRestrictionError("Markdown Editor", "\\.md$", "Markdown files only", "test.js")
		expect(error.message).toBe(
			"This mode (Markdown Editor) can only edit files matching pattern: \\.md$ (Markdown files only). Got: test.js",
		)
		expect(error.name).toBe("FileRestrictionError")
	})
})
