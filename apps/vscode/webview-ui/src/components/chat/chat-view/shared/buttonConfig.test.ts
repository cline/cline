import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import {
	BUTTON_CONFIGS,
	buttonsForPhase,
	getButtonConfig,
	getButtonConfigForMessages,
	getButtonConfigFromState,
} from "./buttonConfig"

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
		const errorStates = ["api_req_failed", "mistake_limit_reached"]

		errorStates.forEach((errorState) => {
			it(`returns correct config for ${errorState}`, () => {
				const errorMessage: ClineMessage = {
					type: "ask",
					ask: errorState as any,
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
	describe("Other Ask States", () => {
		const stateConfigs = [
			{ ask: "followup", expectedConfig: "followup" },
			{ ask: "browser_action_launch", expectedConfig: "browser_action_launch" },
			{ ask: "use_mcp_server", expectedConfig: "use_mcp_server" },
			{ ask: "use_subagents", expectedConfig: "use_subagents" },
			{ ask: "plan_mode_respond", expectedConfig: "plan_mode_respond" },
			{ ask: "completion_result", expectedConfig: "completion_result" },
			{ ask: "resume_task", expectedConfig: "resume_task" },
			{ ask: "resume_completed_task", expectedConfig: "resume_completed_task" },
			{ ask: "new_task", expectedConfig: "new_task" },
			{ ask: "condense", expectedConfig: "condense" },
			{ ask: "report_bug", expectedConfig: "report_bug" },
		]

		stateConfigs.forEach(({ ask, expectedConfig }) => {
			it(`returns ${expectedConfig} config for ${ask} ask`, () => {
				const message: ClineMessage = {
					type: "ask",
					ask: ask as any,
					ts: Date.now(),
				}
				const config = getButtonConfig(message)
				expect(config).toEqual(BUTTON_CONFIGS[expectedConfig])
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

	describe("getButtonConfigForMessages", () => {
		it("keeps web fetch approval buttons when a bookkeeping API usage message is appended after the ask", () => {
			const messages: ClineMessage[] = [
				{ type: "say", say: "task", text: "fetch docs", ts: 1 },
				{
					type: "ask",
					ask: "tool",
					text: JSON.stringify({ tool: "webFetch", path: "https://docs.cline.bot" }),
					ts: 2,
				},
				{
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ tokensIn: 10, tokensOut: 2, cost: 0.001 }),
					ts: 3,
				},
			]

			expect(getButtonConfigForMessages(messages)).toEqual(BUTTON_CONFIGS.tool_approve)
		})

		it("keeps MCP approval buttons when an MCP request-start marker is appended after the ask", () => {
			const messages: ClineMessage[] = [
				{ type: "say", say: "task", text: "use mcp", ts: 1 },
				{ type: "ask", ask: "use_mcp_server", text: "{}", ts: 2 },
				{ type: "say", say: "mcp_server_request_started", ts: 3 },
			]

			expect(getButtonConfigForMessages(messages)).toEqual(BUTTON_CONFIGS.use_mcp_server)
		})

		it("still shows cancel for an active API request", () => {
			const messages: ClineMessage[] = [
				{ type: "say", say: "task", text: "think", ts: 1 },
				{ type: "say", say: "api_req_started", text: JSON.stringify({ request: undefined }), ts: 2 },
			]

			expect(getButtonConfigForMessages(messages)).toEqual(BUTTON_CONFIGS.api_req_active)
		})
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

describe("buttonsForPhase (TurnState-driven)", () => {
	const ts = (phase: TurnState["phase"], anchorTs?: number): TurnState => ({ phase, anchorTs, seq: 1 })

	it("maps phases to their button sets", () => {
		expect(buttonsForPhase(ts("idle"), undefined)).toEqual(BUTTON_CONFIGS.default)
		expect(buttonsForPhase(ts("streaming"), undefined)).toEqual(BUTTON_CONFIGS.partial)
		expect(buttonsForPhase(ts("completed"), undefined)).toEqual(BUTTON_CONFIGS.completion_result)
		expect(buttonsForPhase(ts("resumable"), undefined)).toEqual(BUTTON_CONFIGS.resume_task)
		expect(buttonsForPhase(ts("error"), undefined)).toEqual(BUTTON_CONFIGS.api_req_failed)
		expect(buttonsForPhase(ts("awaiting_followup"), undefined)).toEqual(BUTTON_CONFIGS.followup)
		expect(buttonsForPhase(ts("awaiting_approval"), undefined)).toEqual(BUTTON_CONFIGS.tool_approve)
	})

	it("uses the anchored message to pick approval labels (Save vs Approve, command, mcp)", () => {
		const save: ClineMessage = { ts: 5, type: "ask", ask: "tool", text: JSON.stringify({ tool: "editedExistingFile" }) }
		expect(buttonsForPhase(ts("awaiting_approval", 5), save)).toEqual(BUTTON_CONFIGS.tool_save)

		const command: ClineMessage = { ts: 6, type: "ask", ask: "command", text: "echo hi" }
		expect(buttonsForPhase(ts("awaiting_approval", 6), command)).toEqual(BUTTON_CONFIGS.command)

		const mcp: ClineMessage = { ts: 7, type: "ask", ask: "use_mcp_server", text: "{}" }
		expect(buttonsForPhase(ts("awaiting_approval", 7), mcp)).toEqual(BUTTON_CONFIGS.use_mcp_server)
	})

	it("distinguishes mistake_limit from api_req_failed in the error phase via the anchor", () => {
		const mistake: ClineMessage = { ts: 8, type: "ask", ask: "mistake_limit_reached", text: "" }
		expect(buttonsForPhase(ts("error", 8), mistake)).toEqual(BUTTON_CONFIGS.mistake_limit_reached)
	})
})

describe("getButtonConfigFromState (dispatch + legacy fallback)", () => {
	const approvalAsk: ClineMessage = { ts: 100, type: "ask", ask: "command", text: "echo hi" }

	it("prefers TurnState over the message tail (immune to trailing bookkeeping — RC1)", () => {
		// Tail is a trailing api_req_started, but the authoritative phase is awaiting_approval.
		const messages: ClineMessage[] = [
			approvalAsk,
			{ ts: 101, type: "say", say: "api_req_started", text: JSON.stringify({ tokensIn: 5, cost: 0.01 }) },
		]
		const turnState: TurnState = { phase: "awaiting_approval", anchorTs: 100, seq: 9 }
		const config = getButtonConfigFromState(messages, turnState, "act")
		expect(config).toEqual(BUTTON_CONFIGS.command)
		expect(config.enableButtons).toBe(true)
	})

	it("falls back to legacy tail-walking when TurnState is absent", () => {
		const messages: ClineMessage[] = [approvalAsk]
		expect(getButtonConfigFromState(messages, undefined, "act")).toEqual(getButtonConfigForMessages(messages, "act"))
	})

	it("completed phase shows Start New Task regardless of trailing messages", () => {
		const messages: ClineMessage[] = [
			{ ts: 1, type: "say", say: "completion_result", text: "done" },
			{ ts: 2, type: "say", say: "api_req_started", text: JSON.stringify({ cost: 0.02 }) },
		]
		const turnState: TurnState = { phase: "completed", seq: 3 }
		expect(getButtonConfigFromState(messages, turnState, "act")).toEqual(BUTTON_CONFIGS.completion_result)
	})

	it("streaming phase shows Proceed While Running when a foreground command is running", () => {
		const messages: ClineMessage[] = [{ ts: 1, type: "say", say: "command", text: "npm run dev", partial: true }]
		const turnState: TurnState = { phase: "streaming", seq: 4 }
		expect(getButtonConfigFromState(messages, turnState, "act", true)).toEqual(BUTTON_CONFIGS.foreground_command_running)
		expect(getButtonConfigFromState(messages, turnState, "act", false)).toEqual(BUTTON_CONFIGS.partial)
	})

	it("foreground command flag only affects the streaming phase", () => {
		const messages: ClineMessage[] = []
		expect(getButtonConfigFromState(messages, { phase: "completed", seq: 5 }, "act", true)).toEqual(
			BUTTON_CONFIGS.completion_result,
		)
		expect(getButtonConfigFromState(messages, { phase: "idle", seq: 6 }, "act", true)).toEqual(BUTTON_CONFIGS.default)
	})
})
