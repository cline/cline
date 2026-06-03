import type { CoreSessionEvent } from "@cline/core"
import type { AgentEvent } from "@cline/shared"
import { describe, expect, it } from "vitest"
import { MessageTranslatorState, translateSessionEvent } from "./message-translator"
import { DEFAULT_TOOL_APPROVAL_DENIAL_REASON, USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON } from "./tool-approval-denial"

describe("translateSessionEvent - user-message tool approval denial", () => {
	it("suppresses tool lifecycle events for approval replies routed as user feedback", () => {
		const state = new MessageTranslatorState()
		state.recordDeniedToolApproval("call-1", "fetch_web_content", USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON)

		const startEvent: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName: "fetch_web_content",
					toolCallId: "call-1",
					input: {
						requests: [{ url: "https://example.com", prompt: "Read it" }],
					},
				} as AgentEvent,
			},
		}
		const endEvent: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_end",
					contentType: "tool",
					toolName: "fetch_web_content",
					toolCallId: "call-1",
					error: USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON,
				} as AgentEvent,
			},
		}

		const startResult = translateSessionEvent(startEvent, state)
		const endResult = translateSessionEvent(endEvent, state)

		expect(startResult.messages).toHaveLength(0)
		expect(endResult.messages).toHaveLength(0)
		expect(endResult.toolError).toBeUndefined()
		expect(endResult.toolSuccess).toBeUndefined()
	})

	it("suppresses generic no-button approval denials", () => {
		const state = new MessageTranslatorState()
		state.recordDeniedToolApproval("call-1", "fetch_web_content", DEFAULT_TOOL_APPROVAL_DENIAL_REASON)

		const endEvent: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_end",
					contentType: "tool",
					toolName: "fetch_web_content",
					toolCallId: "call-1",
					error: `{"error":"${DEFAULT_TOOL_APPROVAL_DENIAL_REASON}"}`,
				} as AgentEvent,
			},
		}
		const mistakeEvent: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "error",
					error: new Error(
						`1 tool call(s) failed: [fetch_web_content] {"error":"${DEFAULT_TOOL_APPROVAL_DENIAL_REASON}"}`,
					),
					recoverable: true,
					iteration: 1,
				} as AgentEvent,
			},
		}

		const endResult = translateSessionEvent(endEvent, state)
		const mistakeResult = translateSessionEvent(mistakeEvent, state)

		expect(endResult.messages).toHaveLength(0)
		expect(endResult.toolError).toBeUndefined()
		expect(mistakeResult.messages).toHaveLength(0)
		expect(mistakeResult.turnComplete).toBe(false)
	})

	it("suppresses mistake errors caused by approval replies routed as user feedback", () => {
		const state = new MessageTranslatorState()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "error",
					error: new Error(
						`1 tool call(s) failed: [fetch_web_content] {"error":"${USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON}"}`,
					),
					recoverable: true,
					iteration: 1,
				} as AgentEvent,
			},
		}

		const result = translateSessionEvent(event, state)

		expect(result.messages).toHaveLength(0)
		expect(result.turnComplete).toBe(false)
	})
})
