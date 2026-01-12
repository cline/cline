import { expect } from "chai"
import { describe, it } from "mocha"
import type { ClineMessage } from "@/shared/ExtensionMessage"
import {
	buildNotificationsForMessage,
	buildNotificationsForPartialMessage,
	createAcpConversionState,
} from "@/standalone/acp/convert"

describe("ACP conversion", () => {
	it("maps say text to agent_message_chunk", () => {
		const state = createAcpConversionState()
		const message: ClineMessage = {
			ts: 1,
			type: "say",
			say: "text",
			text: "Hello",
		}

		const notifications = buildNotificationsForMessage(message, "sess-1", state)
		const update = notifications[0].update

		expect(notifications).to.have.length(1)
		expect(update.sessionUpdate).to.equal("agent_message_chunk")
		if (update.sessionUpdate !== "agent_message_chunk") {
			throw new Error("Expected agent_message_chunk")
		}
		expect(update.content?.type).to.equal("text")
		if (update.content?.type !== "text") {
			throw new Error("Expected text content")
		}
		expect(update.content.text).to.equal("Hello")
	})

	it("maps reasoning to agent_thought_chunk", () => {
		const state = createAcpConversionState()
		const message: ClineMessage = {
			ts: 2,
			type: "say",
			say: "reasoning",
			reasoning: "Thinking",
		}

		const notifications = buildNotificationsForMessage(message, "sess-1", state)
		const update = notifications[0].update

		expect(notifications).to.have.length(1)
		expect(update.sessionUpdate).to.equal("agent_thought_chunk")
		if (update.sessionUpdate !== "agent_thought_chunk") {
			throw new Error("Expected agent_thought_chunk")
		}
		expect(update.content?.type).to.equal("text")
		if (update.content?.type !== "text") {
			throw new Error("Expected text content")
		}
		expect(update.content.text).to.equal("Thinking")
	})

	it("maps tool messages to tool_call", () => {
		const state = createAcpConversionState()
		const payload = JSON.stringify({ tool: "readFile", path: "src/index.ts" })
		const message: ClineMessage = {
			ts: 3,
			type: "say",
			say: "tool",
			text: payload,
		}

		const notifications = buildNotificationsForMessage(message, "sess-1", state)
		const update = notifications[0].update

		expect(notifications).to.have.length(1)
		expect(update.sessionUpdate).to.equal("tool_call")
		if (update.sessionUpdate !== "tool_call") {
			throw new Error("Expected tool_call")
		}
		expect(update.title).to.include("Read file")
		expect(update.kind).to.equal("read")
	})

	it("links command output to last command tool call", () => {
		const state = createAcpConversionState()
		const commandMessage: ClineMessage = {
			ts: 4,
			type: "say",
			say: "command",
			text: "ls -la",
		}

		const commandNotifications = buildNotificationsForMessage(commandMessage, "sess-1", state)
		const commandUpdate = commandNotifications[0].update
		expect(commandNotifications).to.have.length(1)
		expect(commandUpdate.sessionUpdate).to.equal("tool_call")
		if (commandUpdate.sessionUpdate !== "tool_call") {
			throw new Error("Expected tool_call")
		}

		const outputMessage: ClineMessage = {
			ts: 5,
			type: "say",
			say: "command_output",
			text: "output",
		}

		const outputNotifications = buildNotificationsForMessage(outputMessage, "sess-1", state)
		const outputUpdate = outputNotifications[0].update
		expect(outputNotifications).to.have.length(1)
		expect(outputUpdate.sessionUpdate).to.equal("tool_call_update")
		if (outputUpdate.sessionUpdate !== "tool_call_update") {
			throw new Error("Expected tool_call_update")
		}
		expect(outputUpdate.content?.[0]?.type).to.equal("content")
	})

	it("emits deltas for partial text", () => {
		const state = createAcpConversionState()
		const baseMessage: ClineMessage = {
			ts: 6,
			type: "say",
			say: "text",
			text: "Hello",
		}

		const first = buildNotificationsForPartialMessage(baseMessage, "sess-1", state, false)
		const firstUpdate = first[0].update
		expect(first).to.have.length(1)
		expect(firstUpdate.sessionUpdate).to.equal("agent_message_chunk")
		if (firstUpdate.sessionUpdate !== "agent_message_chunk") {
			throw new Error("Expected agent_message_chunk")
		}
		expect(firstUpdate.content?.type).to.equal("text")
		if (firstUpdate.content?.type !== "text") {
			throw new Error("Expected text content")
		}
		expect(firstUpdate.content.text).to.equal("Hello")

		const nextMessage: ClineMessage = {
			...baseMessage,
			text: "Hello world",
		}

		const second = buildNotificationsForPartialMessage(nextMessage, "sess-1", state, true)
		const secondUpdate = second[0].update
		expect(second).to.have.length(1)
		expect(secondUpdate.sessionUpdate).to.equal("agent_message_chunk")
		if (secondUpdate.sessionUpdate !== "agent_message_chunk") {
			throw new Error("Expected agent_message_chunk")
		}
		expect(secondUpdate.content?.type).to.equal("text")
		if (secondUpdate.content?.type !== "text") {
			throw new Error("Expected text content")
		}
		expect(secondUpdate.content.text).to.equal(" world")
	})
})
