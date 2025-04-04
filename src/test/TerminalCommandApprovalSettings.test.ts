import { describe, it, beforeEach } from "mocha"
import { expect } from "chai"
import "should"
import { AutoApprovalSettings } from "../shared/AutoApprovalSettings"
import type { TaskLike, ControllerLike } from "./TestTypes"
import * as sinon from "sinon"

describe("TerminalCommandApprovalSettings", () => {
	let task: TaskLike
	let autoApprovalSettings: AutoApprovalSettings
	let mockController: ControllerLike
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Create a mock controller
		mockController = {
			context: {},
			postMessageToWebview: sinon.stub(),
			postStateToWebview: sinon.stub(),
		}

		// Create default auto approval settings (all off)
		autoApprovalSettings = {
			enabled: false,
			actions: {
				readFiles: false,
				editFiles: false,
				executeCommands: false,
				executeAllCommands: false,
				useBrowser: false,
				useMcp: false,
			},
			maxRequests: 20,
			enableNotifications: false,
		}

		// Create a partial Task instance with only the properties we need for testing
		task = {
			autoApprovalSettings,
			shouldAutoApproveTool: (toolName: string, requiresApproval?: boolean) => {
				// Implement the logic for shouldAutoApproveTool here
				if (!task.autoApprovalSettings.enabled) {
					return false
				}

				// Handle different tool types
				switch (toolName) {
					case "read_file":
						return task.autoApprovalSettings.actions.readFiles
					case "write_to_file":
					case "replace_in_file":
						return task.autoApprovalSettings.actions.editFiles
					case "execute_command":
						if (requiresApproval) {
							return task.autoApprovalSettings.actions.executeAllCommands
						}
						return task.autoApprovalSettings.actions.executeCommands
					case "browser_action":
						return task.autoApprovalSettings.actions.useBrowser
					case "use_mcp_tool":
					case "access_mcp_resource":
						return task.autoApprovalSettings.actions.useMcp
					default:
						return false
				}
			},
		}
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should require approval when Approve (general) is off", () => {
		// Set up auto approval settings with general approval off
		task.autoApprovalSettings = {
			...autoApprovalSettings,
			enabled: false,
			actions: {
				...autoApprovalSettings.actions,
				executeCommands: true,
				executeAllCommands: true,
			},
		}

		// Test with a safe command
		const requiresApprovalSafe = !task.shouldAutoApproveTool("execute_command", false)
		expect(requiresApprovalSafe).to.be.true

		// Test with an unsafe command
		const requiresApprovalUnsafe = !task.shouldAutoApproveTool("execute_command", true)
		expect(requiresApprovalUnsafe).to.be.true
	})

	it("should require approval when Approve (general) is on but no terminal-centric settings are on", () => {
		// Set up auto approval settings with general approval on but terminal settings off
		task.autoApprovalSettings = {
			...autoApprovalSettings,
			enabled: true,
			actions: {
				...autoApprovalSettings.actions,
				executeCommands: false,
				executeAllCommands: false,
			},
		}

		// Test with a safe command
		const requiresApprovalSafe = !task.shouldAutoApproveTool("execute_command", false)
		expect(requiresApprovalSafe).to.be.true

		// Test with an unsafe command
		const requiresApprovalUnsafe = !task.shouldAutoApproveTool("execute_command", true)
		expect(requiresApprovalUnsafe).to.be.true
	})

	it("should require approval for unsafe commands when Approve (general) and safe command settings are on", () => {
		// Set up auto approval settings with general approval on and safe command settings on
		task.autoApprovalSettings = {
			...autoApprovalSettings,
			enabled: true,
			actions: {
				...autoApprovalSettings.actions,
				executeCommands: true,
				executeAllCommands: false,
			},
		}

		// Test with a safe command - should NOT require approval
		const requiresApprovalSafe = !task.shouldAutoApproveTool("execute_command", false)
		expect(requiresApprovalSafe).to.be.false

		// Test with an unsafe command - should require approval
		const requiresApprovalUnsafe = !task.shouldAutoApproveTool("execute_command", true)
		expect(requiresApprovalUnsafe).to.be.true
	})

	it("should not require approval for unsafe commands when Approve (general) and all command settings are on", () => {
		// Set up auto approval settings with general approval on and all command settings on
		task.autoApprovalSettings = {
			...autoApprovalSettings,
			enabled: true,
			actions: {
				...autoApprovalSettings.actions,
				executeCommands: true,
				executeAllCommands: true,
			},
		}

		// Test with a safe command - should NOT require approval
		const requiresApprovalSafe = !task.shouldAutoApproveTool("execute_command", false)
		expect(requiresApprovalSafe).to.be.false

		// Test with an unsafe command - should NOT require approval
		const requiresApprovalUnsafe = !task.shouldAutoApproveTool("execute_command", true)
		expect(requiresApprovalUnsafe).to.be.false
	})

	it("should handle different tool types correctly", () => {
		// Set up auto approval settings with general approval on and specific settings
		task.autoApprovalSettings = {
			...autoApprovalSettings,
			enabled: true,
			actions: {
				readFiles: true,
				editFiles: false,
				executeCommands: true,
				executeAllCommands: false,
				useBrowser: false,
				useMcp: false,
			},
		}

		// Test read_file tool - should NOT require approval
		const requiresApprovalReadFile = !task.shouldAutoApproveTool("read_file")
		expect(requiresApprovalReadFile).to.be.false

		// Test write_to_file tool - should require approval
		const requiresApprovalWriteFile = !task.shouldAutoApproveTool("write_to_file")
		expect(requiresApprovalWriteFile).to.be.true

		// Test safe command - should NOT require approval
		const requiresApprovalSafeCommand = !task.shouldAutoApproveTool("execute_command", false)
		expect(requiresApprovalSafeCommand).to.be.false

		// Test unsafe command - should require approval
		const requiresApprovalUnsafeCommand = !task.shouldAutoApproveTool("execute_command", true)
		expect(requiresApprovalUnsafeCommand).to.be.true
	})
})
