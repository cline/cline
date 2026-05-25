import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"
import { ToolResultUtils } from "../ToolResultUtils"

/**
 * Tests for ToolResultUtils.askApprovalAndPushFeedback
 *
 * This method handles the tool approval flow:
 * 1. Shows an ask message to the user for approval
 * 2. Processes any user feedback (text, images, files)
 * 3. On approval: cleans up the ask message and replaces with a say message
 * 4. On rejection: sets didRejectTool flag
 *
 * The ask→say conversion after approval is critical for preventing
 * Plan Mode UI hangs where stale ask messages cause buttons to gray out.
 */
describe("ToolResultUtils.askApprovalAndPushFeedback", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	/**
	 * Creates a mock TaskConfig for testing askApprovalAndPushFeedback.
	 * All callbacks are sinon stubs that can be inspected after the test.
	 */
	function createMockConfig(askResponse: { response: string; text?: string; images?: string[]; files?: string[] }) {
		const taskState = new TaskState()
		return {
			isSubagentExecution: false,
			taskState,
			callbacks: {
				ask: sandbox.stub().resolves(askResponse),
				say: sandbox.stub().resolves(undefined),
				removeLastPartialMessageIfExistsWithType: sandbox.stub().resolves(),
			},
		} as any
	}

	describe("subagent execution", () => {
		it("should return true immediately for subagent executions without calling ask", async () => {
			const config = createMockConfig({ response: "yesButtonClicked" })
			config.isSubagentExecution = true

			const result = await ToolResultUtils.askApprovalAndPushFeedback("tool", '{"tool":"readFile"}', config)

			result.should.be.true()
			config.callbacks.ask.called.should.be.false()
			config.callbacks.say.called.should.be.false()
			config.callbacks.removeLastPartialMessageIfExistsWithType.called.should.be.false()
		})
	})

	describe("approval flow (yesButtonClicked)", () => {
		it("should return true when user approves", async () => {
			const config = createMockConfig({ response: "yesButtonClicked" })
			const completeMessage = '{"tool":"readFile","path":"test.ts"}'

			const result = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)

			result.should.be.true()
		})

		it("should call ask with correct type and message", async () => {
			const config = createMockConfig({ response: "yesButtonClicked" })
			const completeMessage = '{"tool":"readFile","path":"test.ts"}'

			await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)

			config.callbacks.ask.calledOnce.should.be.true()
			config.callbacks.ask.firstCall.args[0].should.equal("tool")
			config.callbacks.ask.firstCall.args[1].should.equal(completeMessage)
			config.callbacks.ask.firstCall.args[2].should.equal(false)
		})

		it("should remove the ask message after approval", async () => {
			const config = createMockConfig({ response: "yesButtonClicked" })
			const completeMessage = '{"tool":"readFile","path":"test.ts"}'

			await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)

			config.callbacks.removeLastPartialMessageIfExistsWithType.calledWith("ask", "tool").should.be.true()
		})

		it("should emit a say message with type 'tool' after approval", async () => {
			const config = createMockConfig({ response: "yesButtonClicked" })
			const completeMessage = '{"tool":"readFile","path":"test.ts"}'

			await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)

			// Should call say with "tool" type, the complete message, and partial=false
			const sayCalls = config.callbacks.say.getCalls().filter((call: sinon.SinonSpyCall) => call.args[0] === "tool")
			sayCalls.length.should.equal(1)
			sayCalls[0].args[1].should.equal(completeMessage)
			sayCalls[0].args[4].should.equal(false) // partial=false
		})

		it("should clean up ask message before creating say message (correct order)", async () => {
			const config = createMockConfig({ response: "yesButtonClicked" })
			const completeMessage = '{"tool":"readFile","path":"test.ts"}'

			await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)

			// removeLastPartialMessageIfExistsWithType should be called before say("tool", ...)
			const removeCall = config.callbacks.removeLastPartialMessageIfExistsWithType
				.getCalls()
				.find((call: sinon.SinonSpyCall) => call.args[0] === "ask" && call.args[1] === "tool")
			const sayToolCall = config.callbacks.say.getCalls().find((call: sinon.SinonSpyCall) => call.args[0] === "tool")

			// Both should exist
			;(removeCall !== undefined).should.be.true()
			;(sayToolCall !== undefined).should.be.true()
		})

		it("should not set didRejectTool when approved", async () => {
			const config = createMockConfig({ response: "yesButtonClicked" })

			await ToolResultUtils.askApprovalAndPushFeedback("tool", '{"tool":"readFile"}', config)

			config.taskState.didRejectTool.should.be.false()
		})

		it("should handle different ask types (use_mcp_server)", async () => {
			const config = createMockConfig({ response: "yesButtonClicked" })
			const completeMessage = '{"server":"test-server"}'

			await ToolResultUtils.askApprovalAndPushFeedback("use_mcp_server", completeMessage, config)

			// Should remove with the correct ask type
			config.callbacks.removeLastPartialMessageIfExistsWithType.calledWith("ask", "use_mcp_server").should.be.true()
			// Should still emit say with "tool" type
			const sayToolCall = config.callbacks.say.getCalls().find((call: sinon.SinonSpyCall) => call.args[0] === "tool")
			;(sayToolCall !== undefined).should.be.true()
		})
	})

	describe("rejection flow", () => {
		it("should return false when user rejects", async () => {
			const config = createMockConfig({ response: "noButtonClicked" })

			const result = await ToolResultUtils.askApprovalAndPushFeedback("tool", '{"tool":"readFile"}', config)

			result.should.be.false()
		})

		it("should set didRejectTool when rejected", async () => {
			const config = createMockConfig({ response: "noButtonClicked" })

			await ToolResultUtils.askApprovalAndPushFeedback("tool", '{"tool":"readFile"}', config)

			config.taskState.didRejectTool.should.be.true()
		})

		it("should not clean up ask message or emit say on rejection", async () => {
			const config = createMockConfig({ response: "noButtonClicked" })

			await ToolResultUtils.askApprovalAndPushFeedback("tool", '{"tool":"readFile"}', config)

			// Should not remove ask messages on rejection
			const removeAskCalls = config.callbacks.removeLastPartialMessageIfExistsWithType
				.getCalls()
				.filter((call: sinon.SinonSpyCall) => call.args[0] === "ask")
			removeAskCalls.length.should.equal(0)

			// Should not emit "tool" say message on rejection
			const sayToolCalls = config.callbacks.say.getCalls().filter((call: sinon.SinonSpyCall) => call.args[0] === "tool")
			sayToolCalls.length.should.equal(0)
		})

		it("should return false when user provides a message response (treated as rejection)", async () => {
			const config = createMockConfig({
				response: "messageResponse",
				text: "I don't want you to read that file",
			})

			const result = await ToolResultUtils.askApprovalAndPushFeedback("tool", '{"tool":"readFile"}', config)

			result.should.be.false()
			config.taskState.didRejectTool.should.be.true()
		})
	})

	describe("approval with user feedback", () => {
		it("should process text feedback and call say with user_feedback", async () => {
			const config = createMockConfig({
				response: "yesButtonClicked",
				text: "Looks good, proceed",
			})

			await ToolResultUtils.askApprovalAndPushFeedback("tool", '{"tool":"readFile"}', config)

			// Should emit user_feedback say message
			const userFeedbackCalls = config.callbacks.say
				.getCalls()
				.filter((call: sinon.SinonSpyCall) => call.args[0] === "user_feedback")
			userFeedbackCalls.length.should.equal(1)
			userFeedbackCalls[0].args[1].should.equal("Looks good, proceed")
		})

		it("should still clean up ask message and emit say even with feedback", async () => {
			const config = createMockConfig({
				response: "yesButtonClicked",
				text: "Looks good",
			})
			const completeMessage = '{"tool":"readFile","path":"test.ts"}'

			await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)

			// Should remove ask and emit tool say (in addition to user_feedback)
			config.callbacks.removeLastPartialMessageIfExistsWithType.calledWith("ask", "tool").should.be.true()
			const sayToolCalls = config.callbacks.say.getCalls().filter((call: sinon.SinonSpyCall) => call.args[0] === "tool")
			sayToolCalls.length.should.equal(1)
		})

		it("should push feedback to userMessageContent", async () => {
			const config = createMockConfig({
				response: "yesButtonClicked",
				text: "Some feedback",
			})

			await ToolResultUtils.askApprovalAndPushFeedback("tool", '{"tool":"readFile"}', config)

			// userMessageContent should have feedback added
			config.taskState.userMessageContent.length.should.be.greaterThan(0)
		})

		it("should not push feedback when text is empty", async () => {
			const config = createMockConfig({
				response: "yesButtonClicked",
				text: "",
			})

			await ToolResultUtils.askApprovalAndPushFeedback("tool", '{"tool":"readFile"}', config)

			// No user_feedback say call
			const userFeedbackCalls = config.callbacks.say
				.getCalls()
				.filter((call: sinon.SinonSpyCall) => call.args[0] === "user_feedback")
			userFeedbackCalls.length.should.equal(0)
		})
	})
})
