import type { ClineAsk, ClineMessage, ClineSay } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { BUTTON_CONFIGS, getButtonConfig } from "./buttonConfig"

describe("getButtonConfig", () => {
	// Test default behavior
	it("returns default config when no task is provided", () => {
		const task = undefined
		const config = getButtonConfig(task)
		expect(config).toEqual(BUTTON_CONFIGS.default)
	})

	// Test streaming/partial messages
	it("returns partial config for streaming messages", () => {
		const streamingMessage: ClineMessage = {
			type: "say",
			say: "api_req_started",
			partial: true,
			ts: Date.now(),
		}
		const config = getButtonConfig(streamingMessage)
		expect(config).toEqual(BUTTON_CONFIGS.partial)
	})

	// Test error recovery states
	describe("Error Recovery States", () => {
		const errorStates = ["api_req_failed", "mistake_limit_reached", "auto_approval_max_req_reached"]

		errorStates.forEach((errorState) => {
			it(`returns correct config for ${errorState}`, () => {
				const errorMessage: ClineMessage = {
					type: "ask",
					ask: errorState as ClineAsk,
					partial: true,
					text: "",
					ts: Date.now(),
				}
				const config = getButtonConfig(errorMessage)
				expect(config).toEqual(BUTTON_CONFIGS[errorState])
			})
		})
	})

	// Test tool approval states
	describe("Tool Approval States", () => {
		it("returns tool_approve config for generic tool ask", () => {
			const toolMessage: ClineMessage = {
				type: "ask",
				ask: "tool",
				text: JSON.stringify({ tool: "generic_tool" }),
				ts: Date.now(),
			}
			const config = getButtonConfig(toolMessage)
			expect(config).toEqual(BUTTON_CONFIGS.tool_approve)
		})

		it("returns tool_save config for file editing tools", () => {
			const saveMessages = [{ tool: "editedExistingFile" }, { tool: "newFileCreated" }]

			saveMessages.forEach((toolData) => {
				const toolMessage: ClineMessage = {
					type: "ask",
					ask: "tool",
					text: JSON.stringify(toolData),
					ts: Date.now(),
				}
				const config = getButtonConfig(toolMessage)
				expect(config).toEqual(BUTTON_CONFIGS.tool_save)
			})
		})
	})

	// Test command execution states
	describe("Command Execution States", () => {
		it("returns command config for command ask", () => {
			const commandMessage: ClineMessage = {
				type: "ask",
				ask: "command",
				ts: Date.now(),
			}
			const config = getButtonConfig(commandMessage)
			expect(config).toEqual(BUTTON_CONFIGS.command)
		})

		it("returns command_output config for command_output ask", () => {
			const commandOutputMessage: ClineMessage = {
				type: "ask",
				ask: "command_output",
				ts: Date.now(),
			}
			const config = getButtonConfig(commandOutputMessage)
			expect(config).toEqual(BUTTON_CONFIGS.command_output)
		})
	})

	// Test other specific ask states
	describe("Other States", () => {
		const stateConfigs = [
			{ ask: "followup", say: undefined, expectedConfig: "followup" },
			{
				ask: "browser_action_launch",
				say: undefined,
				expectedConfig: "browser_action_launch",
			},
			{
				ask: "use_mcp_server",
				say: undefined,
				expectedConfig: "use_mcp_server",
			},
			{
				ask: "plan_mode_respond",
				say: undefined,
				expectedConfig: "plan_mode_respond",
			},
			{
				ask: "completion_result",
				say: undefined,
				expectedConfig: "completion_result",
			},
			{ ask: "resume_task", say: undefined, expectedConfig: "resume_task" },
			{
				ask: "resume_completed_task",
				say: undefined,
				expectedConfig: "resume_completed_task",
			},
			{ ask: "new_task", say: undefined, expectedConfig: "new_task" },
			{ ask: "condense", say: undefined, expectedConfig: "condense" },
			{ ask: "report_bug", say: undefined, expectedConfig: "report_bug" },
			{ ask: undefined, say: "task_progress", expectedConfig: "default" },
		]

		stateConfigs.forEach(({ ask, say, expectedConfig }) => {
			it(`returns ${expectedConfig} config for ${ask ?? say} ${ask ? "ask" : "say"}`, () => {
				const message: ClineMessage = {
					type: ask ? "ask" : "say",
					ask: ask as ClineAsk | undefined,
					say: say as ClineSay | undefined,
					ts: Date.now(),
					partial: false,
				}
				const config = getButtonConfig(message)
				expect(config).toEqual(expectedConfig ? BUTTON_CONFIGS[expectedConfig] : undefined)
			})
		})
	})

	// Test API request states
	it("returns api_req_active config for api_req_started say message", () => {
		const apiReqMessage: ClineMessage = {
			type: "say",
			say: "api_req_started",
			ts: Date.now(),
		}
		const config = getButtonConfig(apiReqMessage)
		expect(config).toEqual(BUTTON_CONFIGS.api_req_active)
	})

	// Test mode parameter (though not extensively used in the current implementation)
	it("handles mode parameter without changing core behavior", () => {
		const message: ClineMessage = {
			type: "ask",
			ask: "tool",
			text: JSON.stringify({ tool: "generic_tool" }),
			ts: Date.now(),
		}
		const configAct = getButtonConfig(message, "act")
		const configPlan = getButtonConfig(message, "plan")
		expect(configAct).toEqual(configPlan)
	})
})
