// npx vitest run shared/__tests__/modes.spec.ts

import type { ModeConfig, PromptComponent } from "@roo-code/types"

// Mock setup must come before imports
vi.mock("vscode")

vi.mock("../../core/prompts/sections/custom-instructions", () => ({
	addCustomInstructions: vi.fn().mockResolvedValue("Combined instructions"),
}))

import { isToolAllowedForMode, FileRestrictionError, getFullModeDetails, modes, getModeSelection } from "../modes"
import { addCustomInstructions } from "../../core/prompts/sections/custom-instructions"

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

			// Should allow path-only for architect mode too
			expect(
				isToolAllowedForMode("write_to_file", "architect", [], undefined, {
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

		it("allows architect mode to edit markdown files only", () => {
			// Should allow editing markdown files
			expect(
				isToolAllowedForMode("write_to_file", "architect", [], undefined, {
					path: "test.md",
					content: "# Test",
				}),
			).toBe(true)

			// Should allow applying diffs to markdown files
			expect(
				isToolAllowedForMode("apply_diff", "architect", [], undefined, {
					path: "readme.md",
					diff: "- old\n+ new",
				}),
			).toBe(true)

			// Should reject non-markdown files
			expect(() =>
				isToolAllowedForMode("write_to_file", "architect", [], undefined, {
					path: "test.js",
					content: "console.log('test')",
				}),
			).toThrow(FileRestrictionError)
			expect(() =>
				isToolAllowedForMode("write_to_file", "architect", [], undefined, {
					path: "test.js",
					content: "console.log('test')",
				}),
			).toThrow(/Markdown files only/)

			// Should maintain read capabilities
			expect(isToolAllowedForMode("read_file", "architect", [])).toBe(true)
			expect(isToolAllowedForMode("browser_action", "architect", [])).toBe(true)
			expect(isToolAllowedForMode("use_mcp_tool", "architect", [])).toBe(true)
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

	describe("debug mode", () => {
		it("is configured correctly", () => {
			const debugMode = modes.find((mode) => mode.slug === "debug")
			expect(debugMode).toBeDefined()
			expect(debugMode).toMatchObject({
				slug: "debug",
				name: "🪲 Debug",
				roleDefinition:
					"You are Roo, an expert software debugger specializing in systematic problem diagnosis and resolution.",
				groups: ["read", "edit", "browser", "command", "mcp"],
			})
			expect(debugMode?.customInstructions).toContain(
				"Reflect on 5-7 different possible sources of the problem, distill those down to 1-2 most likely sources, and then add logs to validate your assumptions. Explicitly ask the user to confirm the diagnosis before fixing the problem.",
			)
		})
	})

	describe("getFullModeDetails", () => {
		beforeEach(() => {
			vi.clearAllMocks()
			vi.mocked(addCustomInstructions).mockResolvedValue("Combined instructions")
		})

		it("returns base mode when no overrides exist", async () => {
			const result = await getFullModeDetails("debug")
			expect(result).toMatchObject({
				slug: "debug",
				name: "🪲 Debug",
				roleDefinition:
					"You are Roo, an expert software debugger specializing in systematic problem diagnosis and resolution.",
			})
		})

		it("applies custom mode overrides", async () => {
			const customModes: ModeConfig[] = [
				{
					slug: "debug",
					name: "Custom Debug",
					roleDefinition: "Custom debug role",
					groups: ["read"],
				},
			]

			const result = await getFullModeDetails("debug", customModes)
			expect(result).toMatchObject({
				slug: "debug",
				name: "Custom Debug",
				roleDefinition: "Custom debug role",
				groups: ["read"],
			})
		})

		it("applies prompt component overrides", async () => {
			const customModePrompts = {
				debug: {
					roleDefinition: "Overridden role",
					customInstructions: "Overridden instructions",
				},
			}

			const result = await getFullModeDetails("debug", undefined, customModePrompts)
			expect(result.roleDefinition).toBe("Overridden role")
			expect(result.customInstructions).toBe("Overridden instructions")
		})

		it("combines custom instructions when cwd provided", async () => {
			const options = {
				cwd: "/test/path",
				globalCustomInstructions: "Global instructions",
				language: "en",
			}

			await getFullModeDetails("debug", undefined, undefined, options)

			expect(addCustomInstructions).toHaveBeenCalledWith(
				expect.any(String),
				"Global instructions",
				"/test/path",
				"debug",
				{ language: "en" },
			)
		})

		it("falls back to first mode for non-existent mode", async () => {
			const result = await getFullModeDetails("non-existent")
			expect(result).toMatchObject({
				...modes[0],
				customInstructions: "",
			})
		})
	})

	it("formats error message with description when provided", () => {
		const error = new FileRestrictionError("Markdown Editor", "\\.md$", "Markdown files only", "test.js")
		expect(error.message).toBe(
			"This mode (Markdown Editor) can only edit files matching pattern: \\.md$ (Markdown files only). Got: test.js",
		)
		expect(error.name).toBe("FileRestrictionError")
	})
})

describe("getModeSelection", () => {
	const builtInAskMode = modes.find((m) => m.slug === "ask")!
	const customModesList: ModeConfig[] = [
		{
			slug: "code", // Override
			name: "Custom Code Mode",
			roleDefinition: "Custom Code Role",
			customInstructions: "Custom Code Instructions",
			groups: ["read"],
		},
		{
			slug: "new-custom",
			name: "New Custom Mode",
			roleDefinition: "New Custom Role",
			customInstructions: "New Custom Instructions",
			groups: ["edit"],
		},
	]

	const promptComponentCode: PromptComponent = {
		roleDefinition: "Prompt Component Code Role",
		customInstructions: "Prompt Component Code Instructions",
	}

	const promptComponentAsk: PromptComponent = {
		roleDefinition: "Prompt Component Ask Role",
		customInstructions: "Prompt Component Ask Instructions",
	}

	test("should return built-in mode details if no overrides", () => {
		const selection = getModeSelection("ask")
		expect(selection.roleDefinition).toBe(builtInAskMode.roleDefinition)
		expect(selection.baseInstructions).toBe(builtInAskMode.customInstructions || "")
	})

	test("should prioritize promptComponent for built-in mode if no custom mode exists for that slug", () => {
		const selection = getModeSelection("ask", promptComponentAsk) // "ask" is not in customModesList
		expect(selection.roleDefinition).toBe(promptComponentAsk.roleDefinition)
		expect(selection.baseInstructions).toBe(promptComponentAsk.customInstructions)
	})

	test("should prioritize customMode over built-in mode", () => {
		const selection = getModeSelection("code", undefined, customModesList)
		const customCode = customModesList.find((m) => m.slug === "code")!
		expect(selection.roleDefinition).toBe(customCode.roleDefinition)
		expect(selection.baseInstructions).toBe(customCode.customInstructions)
	})

	test("should prioritize customMode over promptComponent and built-in mode", () => {
		const selection = getModeSelection("code", promptComponentCode, customModesList)
		const customCode = customModesList.find((m) => m.slug === "code")!
		expect(selection.roleDefinition).toBe(customCode.roleDefinition)
		expect(selection.baseInstructions).toBe(customCode.customInstructions)
	})

	test("should return new custom mode details if it exists", () => {
		const selection = getModeSelection("new-custom", undefined, customModesList)
		const newCustom = customModesList.find((m) => m.slug === "new-custom")!
		expect(selection.roleDefinition).toBe(newCustom.roleDefinition)
		expect(selection.baseInstructions).toBe(newCustom.customInstructions)
	})

	test("customMode takes precedence for a new custom mode even if promptComponent is provided", () => {
		const promptComponentNew: PromptComponent = {
			roleDefinition: "Prompt New Custom Role",
			customInstructions: "Prompt New Custom Instructions",
		}
		const selection = getModeSelection("new-custom", promptComponentNew, customModesList)
		const newCustomMode = customModesList.find((m) => m.slug === "new-custom")!
		expect(selection.roleDefinition).toBe(newCustomMode.roleDefinition)
		expect(selection.baseInstructions).toBe(newCustomMode.customInstructions)
	})

	test("should return empty strings if slug does not exist in custom, prompt, or built-in modes", () => {
		const selection = getModeSelection("non-existent-mode", undefined, customModesList)
		expect(selection.roleDefinition).toBe("")
		expect(selection.baseInstructions).toBe("")
	})

	test("customMode's properties are used if customMode exists, ignoring promptComponent's properties", () => {
		const selection = getModeSelection(
			"code",
			{ roleDefinition: "Prompt Role Only", customInstructions: "Prompt Instructions Only" },
			customModesList,
		)
		const customCodeMode = customModesList.find((m) => m.slug === "code")!
		expect(selection.roleDefinition).toBe(customCodeMode.roleDefinition) // Takes from customCodeMode
		expect(selection.baseInstructions).toBe(customCodeMode.customInstructions) // Takes from customCodeMode
	})

	test("handles undefined customInstructions in customMode gracefully", () => {
		const modesWithoutCustomInstructions: ModeConfig[] = [
			{
				slug: "no-instr",
				name: "No Instructions Mode",
				roleDefinition: "Role for no instructions",
				groups: ["read"],
				// customInstructions is undefined
			},
		]
		const selection = getModeSelection("no-instr", undefined, modesWithoutCustomInstructions)
		expect(selection.roleDefinition).toBe("Role for no instructions")
		expect(selection.baseInstructions).toBe("") // Defaults to empty string
	})

	test("handles empty or undefined roleDefinition in customMode gracefully", () => {
		const modesWithEmptyRoleDef: ModeConfig[] = [
			{
				slug: "empty-role",
				name: "Empty Role Mode",
				roleDefinition: "",
				customInstructions: "Instructions for empty role",
				groups: ["read"],
			},
		]
		const selection = getModeSelection("empty-role", undefined, modesWithEmptyRoleDef)
		expect(selection.roleDefinition).toBe("")
		expect(selection.baseInstructions).toBe("Instructions for empty role")

		const modesWithUndefinedRoleDef: ModeConfig[] = [
			{
				slug: "undefined-role",
				name: "Undefined Role Mode",
				roleDefinition: "", // Test undefined explicitly by using an empty string
				customInstructions: "Instructions for undefined role",
				groups: ["read"],
			},
		]
		const selection2 = getModeSelection("undefined-role", undefined, modesWithUndefinedRoleDef)
		expect(selection2.roleDefinition).toBe("")
		expect(selection2.baseInstructions).toBe("Instructions for undefined role")
	})

	test("customMode's defined properties take precedence, undefined ones in customMode result in ''", () => {
		const customModeRoleOnlyList: ModeConfig[] = [
			// Renamed for clarity
			{
				slug: "role-custom",
				name: "Role Custom",
				roleDefinition: "Custom Role Only",
				groups: ["read"] /* customInstructions undefined */,
			},
		]
		const promptComponentInstrOnly: PromptComponent = { customInstructions: "Prompt Instructions Only" }
		// "role-custom" exists in customModeRoleOnlyList
		const selection = getModeSelection("role-custom", promptComponentInstrOnly, customModeRoleOnlyList)
		// customMode is chosen.
		expect(selection.roleDefinition).toBe("Custom Role Only") // From customMode
		expect(selection.baseInstructions).toBe("") // From customMode (undefined || '' -> '')
	})

	test("customMode's defined properties take precedence, empty string ones in customMode are used", () => {
		const customModeInstrOnlyList: ModeConfig[] = [
			// Renamed for clarity
			{
				slug: "instr-custom",
				name: "Instr Custom",
				roleDefinition: "", // Explicitly empty
				customInstructions: "Custom Instructions Only",
				groups: ["read"],
			},
		]
		const promptComponentRoleOnly: PromptComponent = { roleDefinition: "Prompt Role Only" }
		// "instr-custom" exists in customModeInstrOnlyList
		const selection = getModeSelection("instr-custom", promptComponentRoleOnly, customModeInstrOnlyList)
		// customMode is chosen
		expect(selection.roleDefinition).toBe("") // From customMode ( "" || '' -> "")
		expect(selection.baseInstructions).toBe("Custom Instructions Only") // From customMode
	})

	test("customMode with empty/undefined fields takes precedence over promptComponent and builtInMode", () => {
		const customModeMinimal: ModeConfig[] = [
			{ slug: "ask", name: "Custom Ask Minimal", roleDefinition: "", groups: ["read"] }, // roleDef empty, customInstr undefined
		]
		const promptComponentMinimal: PromptComponent = {
			roleDefinition: "Prompt Min Role",
			customInstructions: "Prompt Min Instr",
		}
		// "ask" is in customModeMinimal
		const selection = getModeSelection("ask", promptComponentMinimal, customModeMinimal)
		// customMode is chosen
		expect(selection.roleDefinition).toBe("") // From customModeMinimal
		expect(selection.baseInstructions).toBe("") // From customModeMinimal
	})

	test("promptComponent is used if customMode for slug does not exist, even if customModesList is provided", () => {
		// 'ask' is not in customModesList, but 'code' and 'new-custom' are.
		const selection = getModeSelection("ask", promptComponentAsk, customModesList)
		expect(selection.roleDefinition).toBe(promptComponentAsk.roleDefinition)
		expect(selection.baseInstructions).toBe(promptComponentAsk.customInstructions)
	})

	test("builtInMode is used if customMode for slug does not exist and promptComponent is not provided", () => {
		// 'ask' is not in customModesList
		const selection = getModeSelection("ask", undefined, customModesList)
		expect(selection.roleDefinition).toBe(builtInAskMode.roleDefinition)
		expect(selection.baseInstructions).toBe(builtInAskMode.customInstructions || "")
	})

	test("promptComponent is used if customMode is not provided (undefined customModesList)", () => {
		const selection = getModeSelection("ask", promptComponentAsk, undefined)
		expect(selection.roleDefinition).toBe(promptComponentAsk.roleDefinition)
		expect(selection.baseInstructions).toBe(promptComponentAsk.customInstructions)
	})
})
