import { getShellForProfile } from "@utils/shell"
import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { StandaloneTerminalManager } from "../standalone/StandaloneTerminalManager"

describe("StandaloneTerminalManager terminal profile", () => {
	it("creates terminals using the configured terminal profile's shell", async () => {
		const manager = new StandaloneTerminalManager()
		const profileId = "bash"
		manager.setDefaultTerminalProfile(profileId)

		const terminalInfo = await manager.getOrCreateTerminal(process.cwd())

		// Background execution should resolve the configured profile to a shell
		// path instead of silently falling back to the system default shell.
		assert.equal(terminalInfo.shellPath, getShellForProfile(profileId))
		assert.equal((terminalInfo.terminal as any)._shellPath, getShellForProfile(profileId))
	})

	it("leaves shellPath undefined for the default profile", async () => {
		const manager = new StandaloneTerminalManager()

		const terminalInfo = await manager.getOrCreateTerminal(process.cwd())

		assert.equal(terminalInfo.shellPath, undefined)
	})

	it("does not reuse a terminal whose shell profile no longer matches", async () => {
		const manager = new StandaloneTerminalManager()

		manager.setDefaultTerminalProfile("bash")
		const first = await manager.getOrCreateTerminal(process.cwd())

		manager.setDefaultTerminalProfile("zsh")
		const second = await manager.getOrCreateTerminal(process.cwd())

		assert.notEqual(first.id, second.id)
		assert.equal(second.shellPath, getShellForProfile("zsh"))
	})
})
