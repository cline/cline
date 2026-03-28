import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { groupLowStakesTools, isToolGroup, shouldShowThinkingLoader } from "./messageUtils"

const createTextMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "text",
	text,
	ts,
})

const createToolMessage = (ts: number, tool: string): ClineMessage => ({
	type: "say",
	say: "tool",
	text: JSON.stringify({ tool, path: "src/file.ts" }),
	ts,
})

const createReasoningMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "reasoning",
	text,
	ts,
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeMsg = (overrides: Partial<ClineMessage> & { ts: number }): ClineMessage =>
	({ type: "say", text: "", ...overrides }) as ClineMessage

const apiReqMsg = (ts: number, cost?: number): ClineMessage =>
	makeMsg({ ts, say: "api_req_started", text: JSON.stringify(cost != null ? { cost } : {}) })

const textMsg = (ts: number): ClineMessage => makeMsg({ ts, say: "text", text: "hello" })

const askMsg = (ts: number, ask: string): ClineMessage => makeMsg({ ts, type: "ask", ask } as Partial<ClineMessage> & { ts: number })

// ---------------------------------------------------------------------------
// shouldShowThinkingLoader
// ---------------------------------------------------------------------------

describe("shouldShowThinkingLoader", () => {
	it("returns false when last raw message is an ask (waiting on user)", () => {
		const lastRawMessage = askMsg(2, "followup")
		expect(
			shouldShowThinkingLoader({
				lastRawMessage,
				modifiedMessages: [apiReqMsg(1)],
				groupedMessages: [apiReqMsg(1)],
			}),
		).toBe(false)
	})

	it("returns false for completion_result say (task finished)", () => {
		const lastRawMessage = makeMsg({ ts: 2, say: "completion_result" })
		expect(
			shouldShowThinkingLoader({
				lastRawMessage,
				modifiedMessages: [lastRawMessage],
				groupedMessages: [lastRawMessage],
			}),
		).toBe(false)
	})

	it("returns false for user-cancelled api_req_started", () => {
		const cancelled = makeMsg({ ts: 1, say: "api_req_started", text: JSON.stringify({ cancelReason: "user_cancelled" }) })
		expect(
			shouldShowThinkingLoader({
				lastRawMessage: cancelled,
				modifiedMessages: [cancelled],
				groupedMessages: [cancelled],
			}),
		).toBe(false)
	})

	it("returns true when there are no grouped messages yet (brand-new task)", () => {
		const req = apiReqMsg(1)
		expect(
			shouldShowThinkingLoader({
				lastRawMessage: req,
				modifiedMessages: [req],
				groupedMessages: [],
			}),
		).toBe(true)
	})

	it("returns true after user_feedback while waiting for next turn", () => {
		const feedback = makeMsg({ ts: 2, say: "user_feedback", text: "do this" })
		expect(
			shouldShowThinkingLoader({
				lastRawMessage: feedback,
				modifiedMessages: [apiReqMsg(1), feedback],
				groupedMessages: [apiReqMsg(1), feedback],
			}),
		).toBe(true)
	})

	it("returns true after user_feedback_diff while waiting for next turn", () => {
		const feedback = makeMsg({ ts: 2, say: "user_feedback_diff", text: "diff" })
		expect(
			shouldShowThinkingLoader({
				lastRawMessage: feedback,
				modifiedMessages: [apiReqMsg(1), feedback],
				groupedMessages: [apiReqMsg(1), feedback],
			}),
		).toBe(true)
	})

	it("returns true after checkpoint_created with no further content", () => {
		const checkpoint = makeMsg({ ts: 2, say: "checkpoint_created" })
		expect(
			shouldShowThinkingLoader({
				lastRawMessage: checkpoint,
				modifiedMessages: [apiReqMsg(1), checkpoint],
				groupedMessages: [apiReqMsg(1), checkpoint],
			}),
		).toBe(true)
	})

	it("returns true while api_req_started has no cost (model still working)", () => {
		const pending = apiReqMsg(2) // no cost
		expect(
			shouldShowThinkingLoader({
				lastRawMessage: pending,
				modifiedMessages: [apiReqMsg(1, 0.01), pending],
				groupedMessages: [apiReqMsg(1, 0.01), pending],
			}),
		).toBe(true)
	})

	it("returns false once real text content is the last visible row", () => {
		const text = textMsg(3)
		const completedReq = apiReqMsg(2, 0.01)
		expect(
			shouldShowThinkingLoader({
				lastRawMessage: text,
				modifiedMessages: [apiReqMsg(1), completedReq, text],
				groupedMessages: [completedReq, text],
			}),
		).toBe(false)
	})

	it("returns false when api_req_started has a cost (request complete)", () => {
		const completed = apiReqMsg(2, 0.05)
		expect(
			shouldShowThinkingLoader({
				lastRawMessage: completed,
				modifiedMessages: [completed],
				groupedMessages: [completed],
			}),
		).toBe(false)
	})
})

describe("groupLowStakesTools", () => {
	it("ignores text that arrives after a low-stakes tool group has started", () => {
		const grouped = groupLowStakesTools([
			createTextMessage(1, "Initial text"),
			createToolMessage(2, "readFile"),
			createTextMessage(3, "Late text that should be ignored"),
		])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "text", text: "Initial text" })
		expect(isToolGroup(grouped[1])).toBe(true)

		if (isToolGroup(grouped[1])) {
			expect(grouped[1].every((message) => message.say !== "text")).toBe(true)
		}
	})

	it("keeps text when no low-stakes tool group is active", () => {
		const grouped = groupLowStakesTools([
			createTextMessage(1, "Initial text"),
			createToolMessage(2, "editedExistingFile"),
			createTextMessage(3, "Follow-up text"),
		])

		expect(grouped).toHaveLength(3)
		expect(grouped[0]).toMatchObject({ type: "say", say: "text", text: "Initial text" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "tool" })
		expect(grouped[2]).toMatchObject({ type: "say", say: "text", text: "Follow-up text" })
	})

	it("keeps standalone reasoning when no low-stakes tool group follows", () => {
		const grouped = groupLowStakesTools([
			createReasoningMessage(1, "Thinking through options"),
			createTextMessage(2, "Answer text"),
		])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Thinking through options" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "text", text: "Answer text" })
	})

	it("keeps standalone reasoning before a non-low-stakes tool", () => {
		const grouped = groupLowStakesTools([
			createReasoningMessage(1, "Thinking through options"),
			createToolMessage(2, "editedExistingFile"),
		])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Thinking through options" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "tool" })
	})

	it("keeps reasoning visible when low-stakes tool group starts immediately after", () => {
		const grouped = groupLowStakesTools([createReasoningMessage(1, "Planning next read"), createToolMessage(2, "readFile")])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Planning next read" })
		expect(isToolGroup(grouped[1])).toBe(true)
	})
})
