import { isToolAllowedForMode, FileRestrictionError, ModeConfig, parseSlashCommand } from "../modes"

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
		{
			slug: "test-exp-mode",
			name: "Test Exp Mode",
			roleDefinition: "You are an experimental tester",
			groups: ["read", "edit", "browser"],
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
				content: "# Test",
			})
			expect(mdResult).toBe(true)

			// Test CSS editor mode
			const cssResult = isToolAllowedForMode("write_to_file", "css-editor", customModes, undefined, {
				path: "styles.css",
				content: ".test { color: red; }",
			})
			expect(cssResult).toBe(true)
		})

		it("rejects editing non-matching files", () => {
			// Test markdown editor mode with non-markdown file
			expect(() =>
				isToolAllowedForMode("write_to_file", "markdown-editor", customModes, undefined, {
					path: "test.js",
					content: "console.log('test')",
				}),
			).toThrow(FileRestrictionError)
			expect(() =>
				isToolAllowedForMode("write_to_file", "markdown-editor", customModes, undefined, {
					path: "test.js",
					content: "console.log('test')",
				}),
			).toThrow(/\\.md\$/)

			// Test CSS editor mode with non-CSS file
			expect(() =>
				isToolAllowedForMode("write_to_file", "css-editor", customModes, undefined, {
					path: "test.js",
					content: "console.log('test')",
				}),
			).toThrow(FileRestrictionError)
			expect(() =>
				isToolAllowedForMode("write_to_file", "css-editor", customModes, undefined, {
					path: "test.js",
					content: "console.log('test')",
				}),
			).toThrow(/\\.css\$/)
		})

		it("handles partial streaming cases (path only, no content/diff)", () => {
			// Should allow path-only for matching files (no validation yet since content/diff not provided)
			expect(
				isToolAllowedForMode("write_to_file", "markdown-editor", customModes, undefined, {
					path: "test.js",
				}),
			).toBe(true)

			expect(
				isToolAllowedForMode("apply_diff", "markdown-editor", customModes, undefined, {
					path: "test.js",
				}),
			).toBe(true)

			// Should allow path-only for ask mode too
			expect(
				isToolAllowedForMode("write_to_file", "ask", [], undefined, {
					path: "test.js",
				}),
			).toBe(true)
		})

		it("applies restrictions to both write_to_file and apply_diff", () => {
			// Test write_to_file
			const writeResult = isToolAllowedForMode("write_to_file", "markdown-editor", customModes, undefined, {
				path: "test.md",
				content: "# Test",
			})
			expect(writeResult).toBe(true)

			// Test apply_diff
			const diffResult = isToolAllowedForMode("apply_diff", "markdown-editor", customModes, undefined, {
				path: "test.md",
				diff: "- old\n+ new",
			})
			expect(diffResult).toBe(true)

			// Test both with non-matching file
			expect(() =>
				isToolAllowedForMode("write_to_file", "markdown-editor", customModes, undefined, {
					path: "test.js",
					content: "console.log('test')",
				}),
			).toThrow(FileRestrictionError)

			expect(() =>
				isToolAllowedForMode("apply_diff", "markdown-editor", customModes, undefined, {
					path: "test.js",
					diff: "- old\n+ new",
				}),
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
					content: "console.log('test')",
				}),
			).toThrow(FileRestrictionError)
			expect(() =>
				isToolAllowedForMode("write_to_file", "docs-editor", customModesWithDescription, undefined, {
					path: "test.js",
					content: "console.log('test')",
				}),
			).toThrow(/Documentation files only/)

			// Test apply_diff with non-matching file
			expect(() =>
				isToolAllowedForMode("apply_diff", "docs-editor", customModesWithDescription, undefined, {
					path: "test.js",
					diff: "- old\n+ new",
				}),
			).toThrow(FileRestrictionError)
			expect(() =>
				isToolAllowedForMode("apply_diff", "docs-editor", customModesWithDescription, undefined, {
					path: "test.js",
					diff: "- old\n+ new",
				}),
			).toThrow(/Documentation files only/)

			// Test that matching files are allowed
			expect(
				isToolAllowedForMode("write_to_file", "docs-editor", customModesWithDescription, undefined, {
					path: "test.md",
					content: "# Test",
				}),
			).toBe(true)

			expect(
				isToolAllowedForMode("write_to_file", "docs-editor", customModesWithDescription, undefined, {
					path: "test.txt",
					content: "Test content",
				}),
			).toBe(true)

			// Test partial streaming cases
			expect(
				isToolAllowedForMode("write_to_file", "docs-editor", customModesWithDescription, undefined, {
					path: "test.js",
				}),
			).toBe(true)
		})

		it("allows ask mode to edit markdown files only", () => {
			// Should allow editing markdown files
			expect(
				isToolAllowedForMode("write_to_file", "ask", [], undefined, {
					path: "test.md",
					content: "# Test",
				}),
			).toBe(true)

			// Should allow applying diffs to markdown files
			expect(
				isToolAllowedForMode("apply_diff", "ask", [], undefined, {
					path: "readme.md",
					diff: "- old\n+ new",
				}),
			).toBe(true)

			// Should reject non-markdown files
			expect(() =>
				isToolAllowedForMode("write_to_file", "ask", [], undefined, {
					path: "test.js",
					content: "console.log('test')",
				}),
			).toThrow(FileRestrictionError)
			expect(() =>
				isToolAllowedForMode("write_to_file", "ask", [], undefined, {
					path: "test.js",
					content: "console.log('test')",
				}),
			).toThrow(/Markdown files only/)

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

	describe("experimental tools", () => {
		it("disables tools when experiment is disabled", () => {
			const experiments = {
				search_and_replace: false,
				insert_content: false,
			}

			expect(
				isToolAllowedForMode(
					"search_and_replace",
					"test-exp-mode",
					customModes,
					undefined,
					undefined,
					experiments,
				),
			).toBe(false)

			expect(
				isToolAllowedForMode("insert_content", "test-exp-mode", customModes, undefined, undefined, experiments),
			).toBe(false)
		})

		it("allows tools when experiment is enabled", () => {
			const experiments = {
				search_and_replace: true,
				insert_content: true,
			}

			expect(
				isToolAllowedForMode(
					"search_and_replace",
					"test-exp-mode",
					customModes,
					undefined,
					undefined,
					experiments,
				),
			).toBe(true)

			expect(
				isToolAllowedForMode("insert_content", "test-exp-mode", customModes, undefined, undefined, experiments),
			).toBe(true)
		})

		it("allows non-experimental tools when experiments are disabled", () => {
			const experiments = {
				search_and_replace: false,
				insert_content: false,
			}

			expect(
				isToolAllowedForMode("read_file", "markdown-editor", customModes, undefined, undefined, experiments),
			).toBe(true)
			expect(
				isToolAllowedForMode(
					"write_to_file",
					"markdown-editor",
					customModes,
					undefined,
					{ path: "test.md" },
					experiments,
				),
			).toBe(true)
		})
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

describe("parseSlashCommand", () => {
	const customModes: ModeConfig[] = [
		{
			slug: "custom-mode",
			name: "Custom Mode",
			roleDefinition: "Custom role",
			groups: ["read"],
		},
	]

	it("returns null for non-slash messages", () => {
		expect(parseSlashCommand("hello world")).toBeNull()
		expect(parseSlashCommand("code help me")).toBeNull()
	})

	it("returns null for incomplete commands", () => {
		expect(parseSlashCommand("/")).toBeNull()
		expect(parseSlashCommand("/code")).toBeNull()
		expect(parseSlashCommand("/code ")).toBeNull()
	})

	it("returns null for invalid mode slugs", () => {
		expect(parseSlashCommand("/invalid help me")).toBeNull()
		expect(parseSlashCommand("/nonexistent do something")).toBeNull()
	})

	it("successfully parses valid commands", () => {
		expect(parseSlashCommand("/code help me write tests")).toEqual({
			modeSlug: "code",
			remainingMessage: "help me write tests",
		})

		expect(parseSlashCommand("/ask what is typescript?")).toEqual({
			modeSlug: "ask",
			remainingMessage: "what is typescript?",
		})

		expect(parseSlashCommand("/architect plan this feature")).toEqual({
			modeSlug: "architect",
			remainingMessage: "plan this feature",
		})
	})

	it("preserves whitespace in remaining message", () => {
		expect(parseSlashCommand("/code   help   me   write   tests  ")).toEqual({
			modeSlug: "code",
			remainingMessage: "help me write tests",
		})
	})

	it("handles custom modes", () => {
		expect(parseSlashCommand("/custom-mode do something", customModes)).toEqual({
			modeSlug: "custom-mode",
			remainingMessage: "do something",
		})
	})

	it("returns null for invalid custom mode slugs", () => {
		expect(parseSlashCommand("/invalid-custom do something", customModes)).toBeNull()
	})
})
