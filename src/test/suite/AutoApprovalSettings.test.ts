import { AutoApprovalSettings, TaskLike, TerminalManagerLike } from "./AutoApprovalSettingsTypes"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "../../shared/AutoApprovalSettings"
import { describe, it, beforeEach, afterEach } from "mocha"
import "should"
import * as sinon from "sinon"

describe("AutoApprovalSettings Terminal Permissions", () => {
	const safeCommand = "echo Hello, World!"
	const unsafeCommand = "rm -rf /"

	let sandbox: sinon.SinonSandbox
	let mockTerminalManager: TerminalManagerLike
	let mockTask: TaskLike

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		mockTerminalManager = {
			runCommand: sandbox.stub(),
			getOrCreateTerminal: sandbox.stub(),
		}

		mockTask = {
			autoApprovalSettings: DEFAULT_AUTO_APPROVAL_SETTINGS,
			executeCommandTool: sandbox.stub<[string], Promise<[boolean, string]>>(),
		}
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should correctly handle terminal permissions based on auto-approval settings", async () => {
		// Test with auto-approval enabled and executeAllCommands true
		const settingsAllCommands: AutoApprovalSettings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			enabled: true,
			actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, executeAllCommands: true },
		}
		mockTask.autoApprovalSettings = settingsAllCommands
		mockTask.executeCommandTool.withArgs(unsafeCommand).resolves([true, `Command executed: ${unsafeCommand}`])

		const [approved, result] = await mockTask.executeCommandTool(unsafeCommand)
		approved.should.be.true()
		result.should.containEql(`Command executed:`)
		result.should.containEql(unsafeCommand)

		// Test with auto-approval enabled and only executeSafeCommands true
		const settingsSafeCommands: AutoApprovalSettings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			enabled: true,
			actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, executeSafeCommands: true },
		}
		mockTask.autoApprovalSettings = settingsSafeCommands
		mockTask.executeCommandTool.withArgs(safeCommand).resolves([true, `Command executed: ${safeCommand}`])
		mockTask.executeCommandTool.withArgs(unsafeCommand).resolves([false, "Command is still running in the user's terminal."])

		let [safeApproved, safeResult] = await mockTask.executeCommandTool(safeCommand)
		safeApproved.should.be.true()
		safeResult.should.containEql(`Command executed:`)
		safeResult.should.containEql(safeCommand)

		let [unsafeApproved, unsafeResult] = await mockTask.executeCommandTool(unsafeCommand)
		unsafeApproved.should.be.false()
		unsafeResult.should.containEql("Command is still running in the user's terminal.")

		// Test with auto-approval disabled
		const settingsDisabled: AutoApprovalSettings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			enabled: false,
		}
		mockTask.autoApprovalSettings = settingsDisabled
		mockTask.executeCommandTool.withArgs(safeCommand).resolves([false, "Command is still running in the user's terminal."])
		mockTask.executeCommandTool.withArgs(unsafeCommand).resolves([false, "Command is still running in the user's terminal."])

		;[safeApproved, safeResult] = await mockTask.executeCommandTool(safeCommand)
		safeApproved.should.be.false()
		safeResult.should.containEql("Command is still running in the user's terminal.")

		;[unsafeApproved, unsafeResult] = await mockTask.executeCommandTool(unsafeCommand)
		unsafeApproved.should.be.false()
		unsafeResult.should.containEql("Command is still running in the user's terminal.")
	})
})
