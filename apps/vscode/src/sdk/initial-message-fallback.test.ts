import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { buildFallbackInitialMessages } from "./initial-message-fallback"

function say(sayType: ClineMessage["say"], text: string | undefined, ts = 1): ClineMessage {
	return { ts, type: "say", say: sayType, text, partial: false }
}

describe("buildFallbackInitialMessages", () => {
	it("maps task and user_feedback to user turns and text to assistant turns", () => {
		const result = buildFallbackInitialMessages([
			say("task", "Create greeting.txt with hello"),
			say("text", "Plan:\n1. Create the file."),
			say("user_feedback", "sounds good"),
		])

		expect(result).toEqual([
			{ role: "user", content: "Create greeting.txt with hello" },
			{ role: "assistant", content: "Plan:\n1. Create the file." },
			{ role: "user", content: "sounds good" },
		])
	})

	it("merges consecutive same-role messages into one turn", () => {
		const result = buildFallbackInitialMessages([
			say("task", "Do the thing"),
			say("text", "First thought."),
			say("text", "Second thought."),
		])

		expect(result).toEqual([
			{ role: "user", content: "Do the thing" },
			{ role: "assistant", content: "First thought.\n\nSecond thought." },
		])
	})

	it("skips asks, non-conversational says, and empty text", () => {
		const messages: ClineMessage[] = [
			say("task", "Run the tests"),
			say("api_req_started", '{"request":"..."}'),
			{ ts: 2, type: "ask", ask: "command", text: "bun test", partial: false },
			say("text", "   "),
			say("text", undefined),
			say("text", "Running them now."),
		]

		expect(buildFallbackInitialMessages(messages)).toEqual([
			{ role: "user", content: "Run the tests" },
			{ role: "assistant", content: "Running them now." },
		])
	})

	it("returns undefined when nothing recoverable remains", () => {
		expect(buildFallbackInitialMessages([])).toBeUndefined()
		expect(buildFallbackInitialMessages([say("api_req_started", "{}")])).toBeUndefined()
		// Assistant text without a preceding user turn is not a usable seed.
		expect(buildFallbackInitialMessages([say("text", "orphaned output")])).toBeUndefined()
	})
})
