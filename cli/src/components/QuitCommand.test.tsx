import { CLI_ONLY_COMMANDS } from "@shared/slashCommands"
import { describe, expect, it } from "vitest"
import { filterCommands, getStandaloneSlashCommandName } from "../utils/slash-commands"

const cliOnlySlashCommands = CLI_ONLY_COMMANDS.map((cmd) => ({
	name: cmd.name,
	description: cmd.description || "",
	section: cmd.section || "default",
	cliCompatible: true,
}))

describe("Quit Command (/q and /exit)", () => {
	it("prioritizes /q as the selected slash command for an exact q query", () => {
		const result = filterCommands(cliOnlySlashCommands, "q")

		expect(result[0]?.name).toBe("q")
	})

	it("detects /q as a standalone slash command", () => {
		expect(getStandaloneSlashCommandName("/q")).toBe("q")
	})

	it("detects /exit as a standalone slash command", () => {
		expect(getStandaloneSlashCommandName("/exit")).toBe("exit")
	})
})
