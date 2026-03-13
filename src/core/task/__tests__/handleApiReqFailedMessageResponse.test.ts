import { describe, it } from "mocha"
import "should"
import type { ClineContent, ClineStorageMessage } from "@shared/messages/content"
import type { ClineAskResponse } from "@shared/WebviewMessage"

/**
 * Tests for the handleApiReqFailedMessageResponse logic.
 *
 * This method handles the case where a user submits a message while viewing
 * an api_req_failed error (e.g., insufficient funds). The behavior is:
 * - Non-messageResponse responses pass through unchanged
 * - messageResponse with content appends to the last user message in API history
 *   and returns "yesButtonClicked" to simulate a retry
 * - messageResponse with no content still returns "yesButtonClicked"
 *
 * Since handleApiReqFailedMessageResponse is a private method on Task,
 * we test the core logic patterns it implements.
 */

interface AskResult {
	response: ClineAskResponse
	text?: string
	images?: string[]
	files?: string[]
}

/**
 * Simulates the core logic of handleApiReqFailedMessageResponse
 * without requiring a full Task instance.
 */
function simulateHandleApiReqFailedMessageResponse(
	askResult: AskResult,
	apiHistory: ClineStorageMessage[],
): {
	returnValue: ClineAskResponse
	updatedHistory: ClineStorageMessage[]
	saidUserFeedback: boolean
} {
	let saidUserFeedback = false

	if (askResult.response !== "messageResponse") {
		return { returnValue: askResult.response, updatedHistory: apiHistory, saidUserFeedback }
	}

	// Simulate buildUserFeedbackContent - simplified version
	const retryUserContent: ClineContent[] = []
	if (askResult.text) {
		retryUserContent.push({
			type: "text",
			text: `<feedback>\n${askResult.text}\n</feedback>`,
		})
	}

	if (retryUserContent.length > 0) {
		saidUserFeedback = true

		const lastApiMessage = apiHistory.at(-1)

		if (lastApiMessage?.role === "user") {
			const existingUserContent: ClineContent[] = Array.isArray(lastApiMessage.content)
				? lastApiMessage.content
				: [{ type: "text", text: lastApiMessage.content as string }]

			const updatedHistory = [
				...apiHistory.slice(0, -1),
				{
					...lastApiMessage,
					content: [...existingUserContent, ...retryUserContent],
				},
			]
			return { returnValue: "yesButtonClicked", updatedHistory, saidUserFeedback }
		}
		const updatedHistory = [
			...apiHistory,
			{
				role: "user" as const,
				content: retryUserContent,
				ts: Date.now(),
			},
		]
		return { returnValue: "yesButtonClicked", updatedHistory, saidUserFeedback }
	}

	// No content but still messageResponse - return yesButtonClicked
	return { returnValue: "yesButtonClicked", updatedHistory: apiHistory, saidUserFeedback }
}

describe("handleApiReqFailedMessageResponse", () => {
	describe("non-messageResponse passthrough", () => {
		it("should pass through yesButtonClicked unchanged", () => {
			const askResult: AskResult = { response: "yesButtonClicked" }
			const apiHistory: ClineStorageMessage[] = []

			const result = simulateHandleApiReqFailedMessageResponse(askResult, apiHistory)

			result.returnValue.should.equal("yesButtonClicked")
			result.saidUserFeedback.should.be.false()
			result.updatedHistory.should.have.length(0)
		})

		it("should pass through noButtonClicked unchanged", () => {
			const askResult: AskResult = { response: "noButtonClicked" }
			const apiHistory: ClineStorageMessage[] = []

			const result = simulateHandleApiReqFailedMessageResponse(askResult, apiHistory)

			result.returnValue.should.equal("noButtonClicked")
			result.saidUserFeedback.should.be.false()
		})
	})

	describe("messageResponse with text content", () => {
		it("should append to last user message and return yesButtonClicked", () => {
			const askResult: AskResult = {
				response: "messageResponse",
				text: "Please try a different approach",
			}
			const apiHistory: ClineStorageMessage[] = [
				{
					role: "user",
					content: [{ type: "text", text: "Original user message" }],
					ts: 1000,
				},
			]

			const result = simulateHandleApiReqFailedMessageResponse(askResult, apiHistory)

			result.returnValue.should.equal("yesButtonClicked")
			result.saidUserFeedback.should.be.true()
			result.updatedHistory.should.have.length(1)

			// The last user message should have the original content plus the new feedback
			const lastMsg = result.updatedHistory[0]
			lastMsg.role.should.equal("user")
			const content = lastMsg.content as ClineContent[]
			content.should.have.length(2)
			;(content[0] as any).text.should.equal("Original user message")
			;(content[1] as any).text.should.containEql("Please try a different approach")
		})

		it("should add new user message when last message is assistant", () => {
			const askResult: AskResult = {
				response: "messageResponse",
				text: "Try again with more context",
			}
			const apiHistory: ClineStorageMessage[] = [
				{
					role: "user",
					content: [{ type: "text", text: "Original request" }],
					ts: 1000,
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "I encountered an error" }],
					ts: 2000,
				},
			]

			const result = simulateHandleApiReqFailedMessageResponse(askResult, apiHistory)

			result.returnValue.should.equal("yesButtonClicked")
			result.saidUserFeedback.should.be.true()
			result.updatedHistory.should.have.length(3)

			// Original messages should be preserved
			result.updatedHistory[0].role.should.equal("user")
			result.updatedHistory[1].role.should.equal("assistant")

			// New user message should be appended
			const newMsg = result.updatedHistory[2]
			newMsg.role.should.equal("user")
			const content = newMsg.content as ClineContent[]
			content.should.have.length(1)
			;(content[0] as any).text.should.containEql("Try again with more context")
		})

		it("should handle last user message with string content (not array)", () => {
			const askResult: AskResult = {
				response: "messageResponse",
				text: "Additional context",
			}
			const apiHistory: ClineStorageMessage[] = [
				{
					role: "user",
					content: "Simple string content" as any,
					ts: 1000,
				},
			]

			const result = simulateHandleApiReqFailedMessageResponse(askResult, apiHistory)

			result.returnValue.should.equal("yesButtonClicked")
			result.saidUserFeedback.should.be.true()

			// Should convert string content to array and append
			const lastMsg = result.updatedHistory[0]
			const content = lastMsg.content as ClineContent[]
			content.should.have.length(2)
			;(content[0] as any).text.should.equal("Simple string content")
			;(content[1] as any).text.should.containEql("Additional context")
		})
	})

	describe("messageResponse without content", () => {
		it("should return yesButtonClicked when text is empty", () => {
			const askResult: AskResult = {
				response: "messageResponse",
				text: "",
			}
			const apiHistory: ClineStorageMessage[] = [
				{
					role: "user",
					content: [{ type: "text", text: "Original" }],
					ts: 1000,
				},
			]

			const result = simulateHandleApiReqFailedMessageResponse(askResult, apiHistory)

			result.returnValue.should.equal("yesButtonClicked")
			result.saidUserFeedback.should.be.false()
			// History should not be modified
			result.updatedHistory.should.have.length(1)
		})

		it("should return yesButtonClicked when text is undefined", () => {
			const askResult: AskResult = {
				response: "messageResponse",
				text: undefined,
			}
			const apiHistory: ClineStorageMessage[] = []

			const result = simulateHandleApiReqFailedMessageResponse(askResult, apiHistory)

			result.returnValue.should.equal("yesButtonClicked")
			result.saidUserFeedback.should.be.false()
		})
	})

	describe("messageResponse with empty API history", () => {
		it("should add new user message when history is empty", () => {
			const askResult: AskResult = {
				response: "messageResponse",
				text: "First message after failure",
			}
			const apiHistory: ClineStorageMessage[] = []

			const result = simulateHandleApiReqFailedMessageResponse(askResult, apiHistory)

			result.returnValue.should.equal("yesButtonClicked")
			result.saidUserFeedback.should.be.true()
			result.updatedHistory.should.have.length(1)
			result.updatedHistory[0].role.should.equal("user")
		})
	})
})
