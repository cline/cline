import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import {
	findVisibleCheckpointUserMessageByRun,
	getCheckpointRunCountForMessage,
	isCheckpointAnswerMessage,
	isVisibleCheckpointUserMessage,
} from "./sdk-checkpoints"

const userTask = (text: string, ts: number): ClineMessage => ({
	ts,
	type: "say",
	say: "task",
	text,
	partial: false,
})

const userFeedback = (text: string, ts: number): ClineMessage => ({
	ts,
	type: "say",
	say: "user_feedback",
	text,
	partial: false,
})

const assistant = (text: string, ts: number): ClineMessage => ({
	ts,
	type: "say",
	say: "text",
	text,
	partial: false,
})

const followupAsk = (text: string, ts: number): ClineMessage => ({
	ts,
	type: "ask",
	ask: "followup",
	text,
	partial: false,
})

const checkpointRow = (runCount: number, ts: number, ref = "old-ref"): ClineMessage => ({
	ts,
	type: "say",
	say: "checkpoint_created",
	partial: false,
	conversationHistoryIndex: runCount,
	lastCheckpointHash: ref,
})

describe("SDK checkpoint user-run mapping", () => {
	it("recognizes only visible user messages", () => {
		expect(isVisibleCheckpointUserMessage(userTask("start", 1))).toBe(true)
		expect(isVisibleCheckpointUserMessage(userFeedback("continue", 2))).toBe(true)
		expect(isVisibleCheckpointUserMessage(assistant("done", 3))).toBe(false)
		expect(isVisibleCheckpointUserMessage(checkpointRow(1, 4))).toBe(false)
	})

	it("finds visible user messages by checkpoint run count", () => {
		const messages = [userTask("start", 1), checkpointRow(1, 2), assistant("done", 3), userFeedback("next", 4)]

		expect(findVisibleCheckpointUserMessageByRun(messages, 1)?.message.text).toBe("start")
		expect(findVisibleCheckpointUserMessageByRun(messages, 2)?.message.text).toBe("next")
		expect(findVisibleCheckpointUserMessageByRun(messages, 3)).toBeUndefined()
	})

	it("does not count ask_question answers as checkpoint runs", () => {
		const messages = [
			userTask("start", 1),
			checkpointRow(1, 2),
			followupAsk("which file?", 3),
			userFeedback("src/index.ts", 4),
			assistant("ok", 5),
			userFeedback("next task", 6),
		]

		expect(isCheckpointAnswerMessage(messages, 3)).toBe(true)
		expect(getCheckpointRunCountForMessage(messages, 0)).toBe(1)
		expect(getCheckpointRunCountForMessage(messages, 3)).toBeUndefined()
		expect(getCheckpointRunCountForMessage(messages, 5)).toBe(2)
		expect(findVisibleCheckpointUserMessageByRun(messages, 2)?.message.text).toBe("next task")
	})

	it("keeps ask answers tied to the ask when assistant rows arrive between them", () => {
		const messages = [
			userTask("start", 1),
			followupAsk("which file?", 2),
			assistant("Let me know the file path.", 3),
			checkpointRow(1, 4),
			userFeedback("src/index.ts", 5),
			userFeedback("next task", 6),
		]

		expect(isCheckpointAnswerMessage(messages, 4)).toBe(true)
		expect(getCheckpointRunCountForMessage(messages, 4)).toBeUndefined()
		expect(getCheckpointRunCountForMessage(messages, 5)).toBe(2)
		expect(findVisibleCheckpointUserMessageByRun(messages, 1)?.message.text).toBe("start")
		expect(findVisibleCheckpointUserMessageByRun(messages, 2)?.message.text).toBe("next task")
	})

	it("does not count tool approval rejection feedback as a checkpoint run", () => {
		const toolAsk: ClineMessage = { ts: 3, type: "ask", ask: "tool", text: "{}", partial: false }
		const messages = [
			userTask("start", 1),
			checkpointRow(1, 2),
			toolAsk,
			userFeedback("no, use the other file", 4),
			assistant("understood", 5),
			userFeedback("next task", 6),
		]

		expect(isCheckpointAnswerMessage(messages, 3)).toBe(true)
		expect(getCheckpointRunCountForMessage(messages, 3)).toBeUndefined()
		expect(getCheckpointRunCountForMessage(messages, 5)).toBe(2)
	})

	it("counts a follow-up sent after the run progressed past a resolved ask as its own run", () => {
		const toolAsk: ClineMessage = { ts: 2, type: "ask", ask: "tool", text: "{}", partial: false }
		const apiReqStarted: ClineMessage = { ts: 3, type: "say", say: "api_req_started", text: "{}", partial: false }
		const completion: ClineMessage = { ts: 5, type: "say", say: "completion_result", text: "done", partial: false }
		const messages = [
			userTask("start", 1),
			toolAsk,
			apiReqStarted,
			assistant("done", 4),
			completion,
			userFeedback("follow-up", 6),
		]

		expect(isCheckpointAnswerMessage(messages, 5)).toBe(false)
		expect(getCheckpointRunCountForMessage(messages, 5)).toBe(2)
	})
})
