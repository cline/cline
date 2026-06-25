import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { filterVisibleMessages, groupLowStakesTools, isToolGroup } from "./messageUtils"

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

const createUserFeedbackMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "user_feedback",
	text,
	ts,
})

const createAskMessage = (
	ts: number,
	ask: "followup" | "plan_mode_respond",
	options: string[],
	selected?: string,
): ClineMessage => ({
	type: "ask",
	ask,
	text: JSON.stringify(
		ask === "followup" ? { question: "Pick one", options, selected } : { response: "Pick one", options, selected },
	),
	ts,
})

describe("filterVisibleMessages", () => {
	it("hides exact user feedback echoes for selected follow-up options", () => {
		const askMessage = createAskMessage(1, "followup", ["Use this", "Use that"], "Use this")
		const visible = filterVisibleMessages([askMessage, createUserFeedbackMessage(2, "Use this")])

		expect(visible).toEqual([askMessage])
	})

	it("hides exact option echoes when selected has not been persisted on the ask row yet", () => {
		const askMessage = createAskMessage(1, "followup", ["Use this", "Use that"])
		const visible = filterVisibleMessages([askMessage, createUserFeedbackMessage(2, "Use this")])

		expect(visible).toEqual([askMessage])
	})

	it("hides exact user feedback echoes for plan-mode response options", () => {
		const askMessage = createAskMessage(1, "plan_mode_respond", ["Plan it", "Do it"], "Plan it")
		const visible = filterVisibleMessages([askMessage, createUserFeedbackMessage(2, "Plan it")])

		expect(visible).toEqual([askMessage])
	})

	it("keeps custom user feedback that extends a selected option", () => {
		const askMessage = createAskMessage(1, "followup", ["Use this", "Use that"], "Use this")
		const userMessage = createUserFeedbackMessage(2, "Use this: include tests")
		const visible = filterVisibleMessages([askMessage, userMessage])

		expect(visible).toEqual([askMessage, userMessage])
	})

	it("keeps exact option feedback when it includes attachments", () => {
		const askMessage = createAskMessage(1, "followup", ["Use this", "Use that"], "Use this")
		const userMessage: ClineMessage = {
			...createUserFeedbackMessage(2, "Use this"),
			images: ["data:image/png;base64,abc"],
		}
		const visible = filterVisibleMessages([askMessage, userMessage])

		expect(visible).toEqual([askMessage, userMessage])
	})
})

describe("groupLowStakesTools", () => {
	it("keeps text that arrives after a low-stakes tool group by finalizing the group first", () => {
		const grouped = groupLowStakesTools([
			createTextMessage(1, "Initial text"),
			createToolMessage(2, "readFile"),
			createTextMessage(3, "Post-tool summary text"),
		])

		expect(grouped).toHaveLength(3)
		expect(grouped[0]).toMatchObject({ type: "say", say: "text", text: "Initial text" })
		expect(isToolGroup(grouped[1])).toBe(true)
		expect(grouped[2]).toMatchObject({ type: "say", say: "text", text: "Post-tool summary text" })
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
