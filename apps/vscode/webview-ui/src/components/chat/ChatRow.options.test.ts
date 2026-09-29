import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { isOptionsAskActive } from "./chat-view/shared/buttonConfig"

const followup: ClineMessage = {
	ts: 2,
	type: "ask",
	ask: "followup",
	text: JSON.stringify({ question: "Which?", options: ["A", "B"] }),
}

describe("isOptionsAskActive", () => {
	it("activates only the authoritative follow-up anchor", () => {
		const turnState: TurnState = { phase: "awaiting_followup", anchorTs: followup.ts, seq: 3 }

		expect(isOptionsAskActive(followup, turnState, false, undefined)).toBe(true)
	})

	it("does not reactivate a historical unselected row during API recovery", () => {
		const turnState: TurnState = { phase: "error", anchorTs: 4, seq: 5 }

		expect(isOptionsAskActive(followup, turnState, false, undefined)).toBe(false)
	})

	it("does not activate a different follow-up anchor", () => {
		const turnState: TurnState = { phase: "awaiting_followup", anchorTs: 4, seq: 5 }

		expect(isOptionsAskActive(followup, turnState, false, undefined)).toBe(false)
	})

	it("keeps the last-message fallback when TurnState is unavailable", () => {
		expect(isOptionsAskActive(followup, undefined, true, followup)).toBe(true)
		expect(isOptionsAskActive(followup, undefined, false, followup)).toBe(false)
	})
})
