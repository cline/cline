import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { describe, expect, it } from "vitest"
import { isToolAutoApproved } from "./sdk-tool-policies"

describe("isToolAutoApproved", () => {
	it("does not auto-approve command tools by default", () => {
		expect(isToolAutoApproved("run_commands", DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(false)
	})

	it("uses executeSafeCommands as the single command approval flag", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				executeSafeCommands: false,
				executeAllCommands: true,
			},
		}

		expect(isToolAutoApproved("run_commands", settings)).toBe(false)
	})

	it("governs monitor with the same command approval flag as run_commands", () => {
		// monitor spawns its own background shell; the "execute commands"
		// toggle must not silently approve run_commands while monitor still
		// prompts (or vice versa).
		expect(isToolAutoApproved("monitor", DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(false)

		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				executeSafeCommands: true,
			},
		}
		expect(isToolAutoApproved("monitor", settings)).toBe(isToolAutoApproved("run_commands", settings))
		expect(isToolAutoApproved("monitor", settings)).toBe(true)
	})
})
