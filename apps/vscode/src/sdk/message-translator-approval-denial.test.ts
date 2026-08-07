import type { CoreSessionEvent } from "@cline/core"
import type { AgentEvent } from "@cline/shared"
import { describe, expect, it } from "vitest"
import { MessageTranslatorState, translateSessionEvent } from "./message-translator"
import {
	DEFAULT_TOOL_APPROVAL_DENIAL_REASON,
	MESSAGE_EDIT_SUPERSEDED_DENIAL_REASON,
	MODE_CHANGED_DENIAL_REASON,
	TASK_CANCELLED_DENIAL_REASON,
	TASK_CLEARED_DENIAL_REASON,
	TASK_SWITCHED_DENIAL_REASON,
	USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON,
} from "./tool-approval-denial"

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

describe("translateSessionEvent - task lifecycle tool approval denial", () => {
	const toolEndEvent = (error: string): CoreSessionEvent => ({
		type: "agent_event",
		payload: {
			sessionId: "session-1",
			event: {
				type: "content_end",
				contentType: "tool",
				toolName: "editor",
				toolCallId: "call-1",
				error,
			} as AgentEvent,
		},
	})

	it.each([
		["task cleared", TASK_CLEARED_DENIAL_REASON],
		["task cancelled", TASK_CANCELLED_DENIAL_REASON],
		["task switched", TASK_SWITCHED_DENIAL_REASON],
		["mode changed", MODE_CHANGED_DENIAL_REASON],
		["message edit superseded", MESSAGE_EDIT_SUPERSEDED_DENIAL_REASON],
	])("suppresses a %s denial replayed without prior denial state", (_label, reason) => {
		const state = new MessageTranslatorState()

		const result = translateSessionEvent(toolEndEvent(JSON.stringify({ error: reason })), state)

		expect(result.messages).toHaveLength(0)
	})

	it.each([
		["a bare reason outside the persisted envelope", TASK_CLEARED_DENIAL_REASON],
		["an envelope that merely contains a reason", `prefix ${JSON.stringify({ error: TASK_CLEARED_DENIAL_REASON })}`],
		["an unrelated tool failure", JSON.stringify({ error: "ENOENT: no such file or directory" })],
	])("still renders %s as a tool error row", (_label, error) => {
		const state = new MessageTranslatorState()

		const result = translateSessionEvent(toolEndEvent(error), state)

		expect(result.messages.some((message) => message.say === "error" && message.text === error)).toBe(true)
	})
})
