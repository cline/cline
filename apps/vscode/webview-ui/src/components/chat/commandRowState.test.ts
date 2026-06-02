import { describe, expect, it } from "vitest"
import { getCommandRowState } from "./commandRowState"

describe("getCommandRowState", () => {
	it("shows an auto-approved command with no output yet as running", () => {
		const state = getCommandRowState(
			{
				partial: true,
				say: "command",
				text: "sleep 30",
				type: "say",
			},
			true,
			true,
		)

		expect(state.isCommandExecuting).toBe(true)
		expect(state.isCommandPending).toBe(false)
		expect(state.title).toBe("Cline is executing this command:")
	})

	it("keeps a command approval prompt pending before execution", () => {
		const state = getCommandRowState(
			{
				ask: "command",
				text: "npm install",
				type: "ask",
			},
			true,
		)

		expect(state.isCommandExecuting).toBe(false)
		expect(state.isCommandPending).toBe(true)
		expect(state.title).toBe("Cline wants to execute this command:")
	})

	it("treats command rows with output as running until marked completed", () => {
		const state = getCommandRowState(
			{
				ask: "command",
				text: "npm test\nOutput:\nrunning tests",
				type: "ask",
			},
			true,
		)

		expect(state.isCommandExecuting).toBe(true)
		expect(state.isCommandPending).toBe(false)
		expect(state.title).toBe("Cline is executing this command:")
	})

	it("shows completed command rows as executed", () => {
		const state = getCommandRowState(
			{
				commandCompleted: true,
				say: "command",
				text: "echo ok\nOutput:\nok",
				type: "say",
			},
			true,
		)

		expect(state.isCommandCompleted).toBe(true)
		expect(state.isCommandExecuting).toBe(false)
		expect(state.title).toBe("Cline executed this command:")
	})
})
