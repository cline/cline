import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { endsOnPresentedPlan } from "./presented-plan"

let ts = 0
function message(partial: Partial<ClineMessage>): ClineMessage {
	ts += 1
	return { ts, type: "say", partial: false, ...partial } as ClineMessage
}

const userMessage = (text = "do the thing") => message({ type: "say", say: "user_feedback", text })
const presentedPlan = (text = "Here is the plan.") => message({ type: "say", say: "plan_completion_result", text })
const actAnswer = (text = "Done.") => message({ type: "say", say: "completion_result", text })
const followupQuestion = () => message({ type: "ask", ask: "followup", text: '{"question":"Which db?"}' })
const reasoning = () => message({ type: "say", say: "reasoning", text: "thinking" })
const apiRequest = () => message({ type: "say", say: "api_req_started", text: "{}" })
const toolRow = () => message({ type: "say", say: "tool", text: "{}" })

describe("endsOnPresentedPlan", () => {
	it("is false for an empty transcript", () => {
		expect(endsOnPresentedPlan([])).toBe(false)
	})

	it("is false when no turn has produced an outcome yet", () => {
		expect(endsOnPresentedPlan([userMessage(), apiRequest(), reasoning()])).toBe(false)
	})

	it("is true when the last turn presented a plan", () => {
		expect(endsOnPresentedPlan([userMessage(), apiRequest(), presentedPlan()])).toBe(true)
	})

	it("ignores bookkeeping rows that trail the plan", () => {
		// Usage rows and checkpoint/tool bookkeeping can land after the turn-final
		// text is retagged, so the plan is not always literally the last message.
		expect(endsOnPresentedPlan([userMessage(), presentedPlan(), apiRequest(), toolRow()])).toBe(true)
	})

	it("is false when an act-mode answer came after the plan", () => {
		// The plan was already acted on: switching plan -> act again must not
		// re-send a continuation.
		expect(endsOnPresentedPlan([presentedPlan(), userMessage("go ahead"), actAnswer()])).toBe(false)
	})

	it("is false when the user replied to the plan and the agent has not answered yet", () => {
		expect(endsOnPresentedPlan([presentedPlan(), userMessage("what about tests?")])).toBe(false)
	})

	it("is false when the agent asked a follow-up question instead of presenting a plan", () => {
		expect(endsOnPresentedPlan([userMessage(), followupQuestion()])).toBe(false)
	})

	it("is true when a plan follows an earlier follow-up question in the same turn", () => {
		expect(endsOnPresentedPlan([userMessage(), followupQuestion(), userMessage("postgres"), presentedPlan()])).toBe(true)
	})

	it("is false after an act-mode turn that ended on a plain answer", () => {
		// The act -> plan -> act round trip the transcript check exists to stop:
		// the turn phase still reads awaiting_followup, but there is no plan.
		expect(endsOnPresentedPlan([userMessage("what does math.js do?"), actAnswer("It exports add().")])).toBe(false)
	})

	it("is false after attempt_completion", () => {
		expect(
			endsOnPresentedPlan([
				presentedPlan(),
				actAnswer(),
				message({ type: "ask", ask: "completion_result", text: "Shipped." }),
			]),
		).toBe(false)
	})

	it("treats a legacy classic-path plan response as a presented plan", () => {
		expect(endsOnPresentedPlan([userMessage(), message({ type: "ask", ask: "plan_mode_respond" })])).toBe(true)
	})

	it("uses the newest plan when several turns presented one", () => {
		expect(endsOnPresentedPlan([presentedPlan("v1"), userMessage("revise it"), presentedPlan("v2")])).toBe(true)
	})
})
