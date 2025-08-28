import * as path from "path"

import { getCommands, getCommand, getCommandNames } from "../services/command/commands"

describe("Command Integration Tests", () => {
	const testWorkspaceDir = path.join(__dirname, "../../")

	it("should discover command files in .roo/commands/", async () => {
		const commands = await getCommands(testWorkspaceDir)

		// Should be able to discover commands (may be empty in test environment)
		expect(Array.isArray(commands)).toBe(true)

		// If commands exist, verify they have valid properties
		commands.forEach((command) => {
			expect(command.name).toBeDefined()
			expect(typeof command.name).toBe("string")
			expect(command.source).toMatch(/^(project|global|built-in)$/)
			expect(command.content).toBeDefined()
			expect(typeof command.content).toBe("string")
		})
	})

	it("should return command names correctly", async () => {
		const commandNames = await getCommandNames(testWorkspaceDir)

		// Should return an array (may be empty in test environment)
		expect(Array.isArray(commandNames)).toBe(true)

		// If command names exist, they should be strings
		commandNames.forEach((name) => {
			expect(typeof name).toBe("string")
			expect(name.length).toBeGreaterThan(0)
		})
	})

	it("should load command content if commands exist", async () => {
		const commands = await getCommands(testWorkspaceDir)

		if (commands.length > 0) {
			const firstCommand = commands[0]
			const loadedCommand = await getCommand(testWorkspaceDir, firstCommand.name)

			expect(loadedCommand).toBeDefined()
			expect(loadedCommand?.name).toBe(firstCommand.name)
			expect(loadedCommand?.source).toMatch(/^(project|global|built-in)$/)
			expect(loadedCommand?.content).toBeDefined()
			expect(typeof loadedCommand?.content).toBe("string")
		}
	})

	it("should handle non-existent commands gracefully", async () => {
		const nonExistentCommand = await getCommand(testWorkspaceDir, "non-existent-command")
		expect(nonExistentCommand).toBeUndefined()
	})
})
