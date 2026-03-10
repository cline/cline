import type { SlashCommandInfo } from "@shared/proto/cline/slash"
import { describe, expect, it } from "vitest"
import { filterCommands } from "./slash-commands"

const createCommand = (name: string): SlashCommandInfo => ({
	name,
	description: `${name} command`,
	section: "default",
	cliCompatible: true,
})

describe("filterCommands", () => {
	it("prioritizes exact matches ahead of fuzzy matches", () => {
		const commands = [createCommand("help"), createCommand("history"), createCommand("q")]

		const result = filterCommands(commands, "q")

		expect(result.map((command) => command.name)[0]).toBe("q")
	})

	it("prioritizes prefix matches ahead of fuzzy matches", () => {
		const commands = [createCommand("history"), createCommand("help"), createCommand("exit")]

		const result = filterCommands(commands, "hi")

		expect(result.map((command) => command.name)[0]).toBe("history")
	})
})
