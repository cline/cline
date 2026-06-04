import { getShellForProfile } from "@utils/shell"
import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { StandaloneTerminalManager } from "../standalone/StandaloneTerminalManager"

// Two profiles that exist with distinct shell paths on the current platform.
// getAvailableTerminalProfiles() only exposes bash/zsh on macOS & Linux and
// powershell/cmd on Windows, so the pair has to be chosen per platform.
const [PROFILE_A, PROFILE_B] = process.platform === "win32" ? ["powershell-7", "cmd"] : ["bash", "zsh"]

describe("StandaloneTerminalManager terminal profile", () => {
	it("creates terminals using the configured terminal profile's shell", async () => {
		const manager = new StandaloneTerminalManager()
		manager.setDefaultTerminalProfile(PROFILE_A)

		const terminalInfo = await manager.getOrCreateTerminal(process.cwd())

		// Background execution should resolve the configured profile to a shell
		// path instead of silently falling back to the system default shell.
		assert.equal(terminalInfo.shellPath, getShellForProfile(PROFILE_A))
	})

	it("leaves shellPath undefined for the default profile", async () => {
		const manager = new StandaloneTerminalManager()

		const terminalInfo = await manager.getOrCreateTerminal(process.cwd())

		assert.equal(terminalInfo.shellPath, undefined)
	})

	it("does not reuse a terminal whose shell profile no longer matches", async () => {
		// Only meaningful when the two profiles resolve to different shells.
		if (getShellForProfile(PROFILE_A) === getShellForProfile(PROFILE_B)) {
			return
		}

		const manager = new StandaloneTerminalManager()

		manager.setDefaultTerminalProfile(PROFILE_A)
		const first = await manager.getOrCreateTerminal(process.cwd())

		manager.setDefaultTerminalProfile(PROFILE_B)
		const second = await manager.getOrCreateTerminal(process.cwd())

		assert.notEqual(first.id, second.id)
		assert.equal(second.shellPath, getShellForProfile(PROFILE_B))
	})
})
