import type { CheckpointEntry } from "@cline/core"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import {
	buildSdkCheckpointRows,
	findVisibleCheckpointUserMessageByRun,
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

const checkpointRow = (runCount: number, ts: number, ref = "old-ref"): ClineMessage => ({
	ts,
	type: "say",
	say: "checkpoint_created",
	partial: false,
	conversationHistoryIndex: runCount,
	lastCheckpointHash: ref,
})

const checkpoint = (runCount: number, ref: string): CheckpointEntry => ({
	runCount,
	ref,
	createdAt: runCount,
	kind: "commit",
})

describe("SDK checkpoint UI mapping", () => {
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

	it("inserts checkpoint rows after visible user messages", () => {
		let ts = 100
		const rows = buildSdkCheckpointRows({
			messages: [userTask("start", 1), assistant("done", 2), userFeedback("next", 3)],
			checkpointHistory: [checkpoint(1, "ref-a"), checkpoint(2, "ref-b")],
			createTimestamp: () => ts++,
		})

		expect(rows.map((message) => [message.say, message.conversationHistoryIndex, message.lastCheckpointHash])).toEqual([
			["task", undefined, undefined],
			["checkpoint_created", 1, "ref-a"],
			["text", undefined, undefined],
			["user_feedback", undefined, undefined],
			["checkpoint_created", 2, "ref-b"],
		])
		expect(rows[1].ts).toBe(100)
		expect(rows[4].ts).toBe(101)
	})

	it("maps deduped checkpoints to later user messages using the nearest earlier checkpoint", () => {
		const rows = buildSdkCheckpointRows({
			messages: [userTask("start", 1), userFeedback("no file changes", 2), userFeedback("new changes", 3)],
			checkpointHistory: [checkpoint(1, "ref-a"), checkpoint(3, "ref-c")],
			createTimestamp: () => 100,
		})

		expect(rows.map((message) => [message.say, message.conversationHistoryIndex, message.lastCheckpointHash])).toEqual([
			["task", undefined, undefined],
			["checkpoint_created", 1, "ref-a"],
			["user_feedback", undefined, undefined],
			["checkpoint_created", 2, "ref-a"],
			["user_feedback", undefined, undefined],
			["checkpoint_created", 3, "ref-c"],
		])
	})

	it("preserves existing checkpoint row identity fields while refreshing SDK metadata", () => {
		const rows = buildSdkCheckpointRows({
			messages: [userTask("start", 1), checkpointRow(1, 42, "stale-ref")],
			checkpointHistory: [checkpoint(1, "fresh-ref")],
			createTimestamp: () => 100,
		})

		expect(rows[1]).toMatchObject({
			ts: 42,
			say: "checkpoint_created",
			conversationHistoryIndex: 1,
			lastCheckpointHash: "fresh-ref",
		})
	})

	it("removes stale checkpoint rows when the SDK session has no checkpoint history", () => {
		const rows = buildSdkCheckpointRows({
			messages: [userTask("start", 1), checkpointRow(1, 2), assistant("done", 3)],
			checkpointHistory: [],
			createTimestamp: () => 100,
		})

		expect(rows.map((message) => message.say)).toEqual(["task", "text"])
	})
})
