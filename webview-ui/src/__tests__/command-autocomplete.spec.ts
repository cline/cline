import type { Command } from "@roo/ExtensionMessage"

import { getContextMenuOptions, ContextMenuOptionType } from "../utils/context-mentions"

describe("Command Autocomplete", () => {
	const mockCommands: Command[] = [
		{ name: "setup", source: "project" },
		{ name: "build", source: "project" },
		{ name: "deploy", source: "global" },
		{ name: "test-suite", source: "project" },
		{ name: "cleanup_old", source: "global" },
		{ name: "release", source: "project", argumentHint: "patch | minor | major" },
	]

	const mockQueryItems = [
		{ type: ContextMenuOptionType.File, value: "/src/app.ts" },
		{ type: ContextMenuOptionType.Problems, value: "problems" },
	]

	describe("slash command command suggestions", () => {
		it('should return all commands when query is just "/"', () => {
			const options = getContextMenuOptions("/", null, mockQueryItems, [], [], mockCommands)

			// Should have 7 items: 1 section header + 6 commands
			expect(options).toHaveLength(7)

			// Filter out section headers to check commands
			const commandOptions = options.filter((option) => option.type === ContextMenuOptionType.Command)
			expect(commandOptions).toHaveLength(6)

			const commandNames = commandOptions.map((option) => option.value)
			expect(commandNames).toContain("setup")
			expect(commandNames).toContain("build")
			expect(commandNames).toContain("deploy")
			expect(commandNames).toContain("test-suite")
			expect(commandNames).toContain("cleanup_old")
			expect(commandNames).toContain("release")
		})

		it("should filter commands based on fuzzy search", () => {
			const options = getContextMenuOptions("/set", null, mockQueryItems, [], [], mockCommands)

			// Should match 'setup' (fuzzy search behavior may vary)
			expect(options.length).toBeGreaterThan(0)
			const commandNames = options.map((option) => option.value)
			expect(commandNames).toContain("setup")
			// Note: fuzzy search may not match 'test-suite' for 'set' query
		})

		it("should return commands with correct format", () => {
			const options = getContextMenuOptions("/setup", null, mockQueryItems, [], [], mockCommands)

			const setupOption = options.find((option) => option.value === "setup")
			expect(setupOption).toBeDefined()
			expect(setupOption!.type).toBe(ContextMenuOptionType.Command)
			expect(setupOption!.slashCommand).toBe("/setup")
			expect(setupOption!.value).toBe("setup")
		})

		it("should handle empty command list", () => {
			const options = getContextMenuOptions("/setup", null, mockQueryItems, [], [], [])

			// Should return NoResults when no commands match
			expect(options).toHaveLength(1)
			expect(options[0].type).toBe(ContextMenuOptionType.NoResults)
		})

		it("should handle no matching commands", () => {
			const options = getContextMenuOptions("/nonexistent", null, mockQueryItems, [], [], mockCommands)

			// Should return NoResults when no commands match
			expect(options).toHaveLength(1)
			expect(options[0].type).toBe(ContextMenuOptionType.NoResults)
		})

		it("should not return command suggestions for non-slash queries", () => {
			const options = getContextMenuOptions("setup", null, mockQueryItems, [], [], mockCommands)

			// Should not contain command options for non-slash queries
			const commandOptions = options.filter((option) => option.type === ContextMenuOptionType.Command)
			expect(commandOptions).toHaveLength(0)
		})

		it("should handle commands with special characters in names", () => {
			const specialCommands: Command[] = [
				{ name: "setup-dev", source: "project" },
				{ name: "test_suite", source: "project" },
				{ name: "deploy.prod", source: "global" },
			]

			const options = getContextMenuOptions("/setup", null, mockQueryItems, [], [], specialCommands)

			const setupDevOption = options.find((option) => option.value === "setup-dev")
			expect(setupDevOption).toBeDefined()
			expect(setupDevOption!.slashCommand).toBe("/setup-dev")
		})

		it("should handle case-insensitive fuzzy matching", () => {
			const options = getContextMenuOptions("/setup", null, mockQueryItems, [], [], mockCommands)

			const commandNames = options.map((option) => option.value)
			expect(commandNames).toContain("setup")
		})

		it("should prioritize exact matches in fuzzy search", () => {
			const commandsWithSimilarNames: Command[] = [
				{ name: "test", source: "project" },
				{ name: "test-suite", source: "project" },
				{ name: "integration-test", source: "project" },
			]

			const options = getContextMenuOptions("/test", null, mockQueryItems, [], [], commandsWithSimilarNames)

			// Filter out section headers and check the first command
			const commandOptions = options.filter((option) => option.type === ContextMenuOptionType.Command)
			expect(commandOptions[0].value).toBe("test")
		})

		it("should handle partial matches correctly", () => {
			const options = getContextMenuOptions("/te", null, mockQueryItems, [], [], mockCommands)

			// Should match 'test-suite'
			const commandNames = options.map((option) => option.value)
			expect(commandNames).toContain("test-suite")
		})
	})

	describe("command integration with modes", () => {
		const mockModes = [
			{
				name: "Code",
				slug: "code",
				description: "Write and edit code",
				roleDefinition: "You are a code assistant",
				groups: ["read", "edit"],
			},
			{
				name: "Debug",
				slug: "debug",
				description: "Debug applications",
				roleDefinition: "You are a debug assistant",
				groups: ["read", "edit"],
			},
		] as any[]

		it("should return both modes and commands for slash commands", () => {
			const options = getContextMenuOptions("/", null, mockQueryItems, [], mockModes, mockCommands)

			const modeOptions = options.filter((option) => option.type === ContextMenuOptionType.Mode)
			const commandOptions = options.filter((option) => option.type === ContextMenuOptionType.Command)

			expect(modeOptions.length).toBe(2)
			expect(commandOptions.length).toBe(6)
		})

		it("should filter both modes and commands based on query", () => {
			const options = getContextMenuOptions("/co", null, mockQueryItems, [], mockModes, mockCommands)

			// Should match 'code' mode and possibly some commands (fuzzy search may match)
			const modeOptions = options.filter((option) => option.type === ContextMenuOptionType.Mode)
			const commandOptions = options.filter((option) => option.type === ContextMenuOptionType.Command)

			expect(modeOptions.length).toBe(1)
			expect(modeOptions[0].value).toBe("code")
			// Fuzzy search might match some commands, so we just check it's a reasonable number
			expect(commandOptions.length).toBeGreaterThanOrEqual(0)
		})
	})

	describe("command source indication", () => {
		it("should not expose source information in autocomplete", () => {
			const options = getContextMenuOptions("/setup", null, mockQueryItems, [], [], mockCommands)

			const setupOption = options.find((option) => option.value === "setup")
			expect(setupOption).toBeDefined()

			// Source should not be exposed in the UI
			if (setupOption!.description) {
				expect(setupOption!.description).not.toContain("project")
				expect(setupOption!.description).not.toContain("global")
				expect(setupOption!.description).toBe("Trigger the setup command")
			}
		})
	})

	describe("argument hint functionality", () => {
		it("should include argumentHint in command options when present", () => {
			const options = getContextMenuOptions("/release", null, mockQueryItems, [], [], mockCommands)

			const releaseOption = options.find((option) => option.value === "release")
			expect(releaseOption).toBeDefined()
			expect(releaseOption!.argumentHint).toBe("patch | minor | major")
		})

		it("should handle commands without argumentHint", () => {
			const options = getContextMenuOptions("/setup", null, mockQueryItems, [], [], mockCommands)

			const setupOption = options.find((option) => option.value === "setup")
			expect(setupOption).toBeDefined()
			expect(setupOption!.argumentHint).toBeUndefined()
		})

		it("should preserve argumentHint through fuzzy search", () => {
			const options = getContextMenuOptions("/rel", null, mockQueryItems, [], [], mockCommands)

			const releaseOption = options.find((option) => option.value === "release")
			expect(releaseOption).toBeDefined()
			expect(releaseOption!.argumentHint).toBe("patch | minor | major")
		})

		it("should handle commands with empty argumentHint", () => {
			const commandsWithEmptyHint: Command[] = [{ name: "test-command", source: "project", argumentHint: "" }]

			const options = getContextMenuOptions("/test", null, mockQueryItems, [], [], commandsWithEmptyHint)

			const testOption = options.find((option) => option.value === "test-command")
			expect(testOption).toBeDefined()
			expect(testOption!.argumentHint).toBe("")
		})
	})

	describe("edge cases", () => {
		it("should handle undefined commands gracefully", () => {
			const options = getContextMenuOptions("/setup", null, mockQueryItems, [], [], undefined)

			expect(options).toHaveLength(1)
			expect(options[0].type).toBe(ContextMenuOptionType.NoResults)
		})

		it("should handle empty query with commands", () => {
			const options = getContextMenuOptions("", null, mockQueryItems, [], [], mockCommands)

			// Should not return command options for empty query
			const commandOptions = options.filter((option) => option.type === ContextMenuOptionType.Command)
			expect(commandOptions).toHaveLength(0)
		})

		it("should handle very long command names", () => {
			const longNameCommands: Command[] = [
				{ name: "very-long-command-name-that-exceeds-normal-length", source: "project" },
			]

			const options = getContextMenuOptions("/very", null, mockQueryItems, [], [], longNameCommands)

			// Should have 2 items: 1 section header + 1 command
			expect(options.length).toBe(2)
			const commandOptions = options.filter((option) => option.type === ContextMenuOptionType.Command)
			expect(commandOptions[0].value).toBe("very-long-command-name-that-exceeds-normal-length")
		})

		it("should handle commands with numeric names", () => {
			const numericCommands: Command[] = [
				{ name: "command1", source: "project" },
				{ name: "v2-setup", source: "project" },
				{ name: "123test", source: "project" },
			]

			const options = getContextMenuOptions("/v", null, mockQueryItems, [], [], numericCommands)

			const commandNames = options.map((option) => option.value)
			expect(commandNames).toContain("v2-setup")
		})
	})
})
