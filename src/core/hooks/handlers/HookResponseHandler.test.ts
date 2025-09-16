/**
 * Tests for HookResponseHandler
 */

import { ToolUse } from "@core/assistant-message"
import { expect } from "chai"
import { beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { ClineDefaultTool } from "@/shared/tools"
import { AggregatedHookResult } from "../types/HookResponse"
import { HookResponseHandler, HookResponseHandlerContext } from "./HookResponseHandler"

describe("HookResponseHandler", () => {
	let handler: HookResponseHandler
	let context: HookResponseHandlerContext
	let sayStub: sinon.SinonStub
	let addContextStub: sinon.SinonStub

	const mockToolBlock: ToolUse = {
		type: "tool_use",
		name: ClineDefaultTool.FILE_READ,
		params: { path: "/test.txt" },
		partial: false,
	}

	beforeEach(() => {
		sayStub = sinon.stub()
		addContextStub = sinon.stub()

		context = {
			say: sayStub,
			addContext: addContextStub,
		}

		handler = new HookResponseHandler(context)
	})

	describe("handlePreToolUseResponse", () => {
		it("should approve when no hooks executed", async () => {
			const result = await handler.handlePreToolUseResponse(null, mockToolBlock)

			expect(result.approved).to.be.true
			expect(result.modifiedBlock).to.be.undefined
			expect(sayStub.called).to.be.false
		})

		it("should approve and display messages", async () => {
			const hookResult: AggregatedHookResult = {
				approve: true,
				messages: ["Hook message 1", "Hook message 2"],
				individualResults: [],
			}

			const result = await handler.handlePreToolUseResponse(hookResult, mockToolBlock)

			expect(result.approved).to.be.true
			expect(sayStub.calledTwice).to.be.true
			expect(sayStub.firstCall.args).to.deep.equal(["text", "Hook message 1"])
			expect(sayStub.secondCall.args).to.deep.equal(["text", "Hook message 2"])
		})

		it("should deny tool execution", async () => {
			const hookResult: AggregatedHookResult = {
				approve: false,
				messages: ["Access denied", "Security violation"],
				individualResults: [],
			}

			const result = await handler.handlePreToolUseResponse(hookResult, mockToolBlock)

			expect(result.approved).to.be.false
			expect(result.modifiedBlock).to.be.undefined

			// Should display denial message
			const errorCall = sayStub.getCalls().find((call) => call.args[0] === "error")
			expect(errorCall).to.not.be.undefined
			expect(errorCall?.args[1]).to.include("Tool execution denied by hook")
			expect(errorCall?.args[1]).to.include("Access denied, Security violation")
		})

		it("should apply input modifications", async () => {
			const hookResult: AggregatedHookResult = {
				approve: true,
				messages: [],
				modifiedInput: {
					path: "/modified/path.txt",
					newParam: "value",
				},
				individualResults: [],
			}

			const result = await handler.handlePreToolUseResponse(hookResult, mockToolBlock)

			expect(result.approved).to.be.true
			expect(result.modifiedBlock).to.not.be.undefined
			expect(result.modifiedBlock?.params.path).to.equal("/modified/path.txt")
			expect((result.modifiedBlock?.params as any).newParam).to.equal("value")
		})

		it("should add additional context", async () => {
			const hookResult: AggregatedHookResult = {
				approve: true,
				messages: [],
				additionalContext: ["Context 1", "Context 2"],
				individualResults: [],
			}

			const result = await handler.handlePreToolUseResponse(hookResult, mockToolBlock)

			expect(result.approved).to.be.true
			expect(addContextStub.calledTwice).to.be.true
			expect(addContextStub.firstCall.args[0]).to.equal("Context 1")
			expect(addContextStub.secondCall.args[0]).to.equal("Context 2")
		})
	})

	describe("handlePostToolUseResponse", () => {
		it("should return empty object when no hooks executed", async () => {
			const result = await handler.handlePostToolUseResponse(null, { output: "original" })

			expect(result).to.deep.equal({})
			expect(sayStub.called).to.be.false
		})

		it("should return modified response", async () => {
			const hookResult: AggregatedHookResult = {
				approve: true,
				messages: [],
				modifiedOutput: { output: "modified result" },
				individualResults: [],
			}

			const result = await handler.handlePostToolUseResponse(hookResult, { output: "original" })

			expect(result.modifiedResponse).to.deep.equal({ output: "modified result" })
		})

		it("should display messages and add context", async () => {
			const hookResult: AggregatedHookResult = {
				approve: true,
				messages: ["Post-processing complete"],
				additionalContext: ["Additional info"],
				individualResults: [],
			}

			await handler.handlePostToolUseResponse(hookResult, { output: "result" })

			expect(sayStub.calledOnce).to.be.true
			expect(sayStub.firstCall.args).to.deep.equal(["text", "Post-processing complete"])
			expect(addContextStub.calledOnce).to.be.true
			expect(addContextStub.firstCall.args[0]).to.equal("Additional info")
		})
	})

	describe("handleUserPromptSubmitResponse", () => {
		it("should approve when no hooks executed", async () => {
			const result = await handler.handleUserPromptSubmitResponse(null, "Test prompt")

			expect(result.approved).to.be.true
			expect(result.modifiedPrompt).to.be.undefined
		})

		it("should deny prompt submission", async () => {
			const hookResult: AggregatedHookResult = {
				approve: false,
				messages: ["Prompt contains sensitive information"],
				individualResults: [],
			}

			const result = await handler.handleUserPromptSubmitResponse(hookResult, "Test prompt")

			expect(result.approved).to.be.false
			expect(result.modifiedPrompt).to.be.undefined

			const errorCall = sayStub.getCalls().find((call) => call.args[0] === "error")
			expect(errorCall?.args[1]).to.include("Prompt submission denied")
		})

		it("should return modified prompt", async () => {
			const hookResult: AggregatedHookResult = {
				approve: true,
				messages: [],
				modifiedInput: "Modified prompt text",
				individualResults: [],
			}

			const result = await handler.handleUserPromptSubmitResponse(hookResult, "Original prompt")

			expect(result.approved).to.be.true
			expect(result.modifiedPrompt).to.equal("Modified prompt text")
		})
	})

	describe("handleGenericResponse", () => {
		it("should do nothing when no hooks executed", async () => {
			await handler.handleGenericResponse(null)

			expect(sayStub.called).to.be.false
			expect(addContextStub.called).to.be.false
		})

		it("should display messages and add context", async () => {
			const hookResult: AggregatedHookResult = {
				approve: true,
				messages: ["Session started"],
				additionalContext: ["Session context"],
				individualResults: [],
			}

			await handler.handleGenericResponse(hookResult)

			expect(sayStub.calledOnce).to.be.true
			expect(sayStub.firstCall.args).to.deep.equal(["hook_message", "Session started"])
			expect(addContextStub.calledOnce).to.be.true
			expect(addContextStub.firstCall.args[0]).to.equal("Session context")
		})
	})

	describe("utility methods", () => {
		describe("formatDenialMessage", () => {
			it("should format denial message with tool name", () => {
				const message = handler.formatDenialMessage("Access denied", "Read")
				expect(message).to.equal("Hook denied execution of 'Read': Access denied")
			})

			it("should format denial message without tool name", () => {
				const message = handler.formatDenialMessage("Invalid operation")
				expect(message).to.equal("Hook denied operation: Invalid operation")
			})
		})

		describe("isApproved", () => {
			it("should return true for null result", () => {
				expect(handler.isApproved(null)).to.be.true
			})

			it("should return true for approved result", () => {
				const result: AggregatedHookResult = {
					approve: true,
					messages: [],
					individualResults: [],
				}
				expect(handler.isApproved(result)).to.be.true
			})

			it("should return false for denied result", () => {
				const result: AggregatedHookResult = {
					approve: false,
					messages: [],
					individualResults: [],
				}
				expect(handler.isApproved(result)).to.be.false
			})
		})

		describe("getConsolidatedMessage", () => {
			it("should return null for null result", () => {
				expect(handler.getConsolidatedMessage(null)).to.be.null
			})

			it("should return null for empty messages", () => {
				const result: AggregatedHookResult = {
					approve: true,
					messages: [],
					individualResults: [],
				}
				expect(handler.getConsolidatedMessage(result)).to.be.null
			})

			it("should consolidate messages", () => {
				const result: AggregatedHookResult = {
					approve: true,
					messages: ["Message 1", "Message 2", "Message 3"],
					individualResults: [],
				}
				const consolidated = handler.getConsolidatedMessage(result)
				expect(consolidated).to.equal("Message 1\nMessage 2\nMessage 3")
			})
		})
	})

	describe("edge cases", () => {
		it("should skip empty messages", async () => {
			const hookResult: AggregatedHookResult = {
				approve: true,
				messages: ["Valid message", "", "  ", "Another message"],
				individualResults: [],
			}

			await handler.handlePreToolUseResponse(hookResult, mockToolBlock)

			// Only non-empty messages should be displayed
			expect(sayStub.calledTwice).to.be.true
			expect(sayStub.firstCall.args[1]).to.equal("Valid message")
			expect(sayStub.secondCall.args[1]).to.equal("Another message")
		})

		it("should skip empty context", async () => {
			const hookResult: AggregatedHookResult = {
				approve: true,
				messages: [],
				additionalContext: ["Valid context", "", "  ", "Another context"],
				individualResults: [],
			}

			await handler.handlePreToolUseResponse(hookResult, mockToolBlock)

			// Only non-empty context should be added
			expect(addContextStub.calledTwice).to.be.true
			expect(addContextStub.firstCall.args[0]).to.equal("Valid context")
			expect(addContextStub.secondCall.args[0]).to.equal("Another context")
		})

		it("should handle missing addContext callback", async () => {
			// Create handler without addContext
			const minimalContext = {
				say: sayStub,
			}
			const minimalHandler = new HookResponseHandler(minimalContext)

			const hookResult: AggregatedHookResult = {
				approve: true,
				messages: [],
				additionalContext: ["Context"],
				individualResults: [],
			}

			// Should not throw error
			await minimalHandler.handlePreToolUseResponse(hookResult, mockToolBlock)
			expect(addContextStub.called).to.be.false
		})
	})
})
