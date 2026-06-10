import { describe, expect, it } from "vitest"
import { ACT_MODE_CONTINUATION_PROMPT } from "./sdk-mode-coordinator"
import { extractSdkUserText, findSdkUserMessageIndexByOrdinal, isSyntheticUserPrompt } from "./sdk-user-message-mapping"

// Persisted prompts are wrapped by formatModePrompt before they reach SDK
// history; the mapping must recognize the wrapped shape, not just raw text.
const wrapped = (text: string, mode = "act") => `<user_input mode="${mode}">${text}</user_input>`

describe("isSyntheticUserPrompt", () => {
	it("flags task resumption and act-mode continuation prompts", () => {
		expect(isSyntheticUserPrompt("[TASK RESUMPTION] Please continue where you left off.")).toBe(true)
		expect(isSyntheticUserPrompt(ACT_MODE_CONTINUATION_PROMPT)).toBe(true)
	})

	it("flags the wrapped persisted shape of synthetic prompts", () => {
		expect(isSyntheticUserPrompt(wrapped(ACT_MODE_CONTINUATION_PROMPT))).toBe(true)
		expect(isSyntheticUserPrompt(wrapped("[TASK RESUMPTION] Please continue where you left off.", "plan"))).toBe(true)
	})

	it("does not flag ordinary user messages, wrapped or raw", () => {
		expect(isSyntheticUserPrompt("make a plan for the auth refactor")).toBe(false)
		expect(isSyntheticUserPrompt(wrapped("go ahead and implement step 1"))).toBe(false)
	})
})

describe("findSdkUserMessageIndexByOrdinal", () => {
	const user = (text: string) => ({ role: "user", content: text })
	const assistant = (text: string) => ({ role: "assistant", content: text })

	it("maps visible ordinals one to one when no synthetic prompts exist", () => {
		const messages = [user("task"), assistant("plan"), user("follow-up")]

		expect(findSdkUserMessageIndexByOrdinal(messages, 1)).toBe(0)
		expect(findSdkUserMessageIndexByOrdinal(messages, 2)).toBe(2)
	})

	it("skips the hidden act-mode continuation prompt as persisted", () => {
		// Plan task, plan presented, empty-composer toggle to act (hidden canned
		// prompt in SDK history, no visible user_feedback), act work, follow-up.
		// Persisted prompts carry the formatModePrompt wrapper.
		const messages = [
			user(wrapped("plan the auth refactor", "plan")),
			assistant("here is the plan"),
			user(wrapped(ACT_MODE_CONTINUATION_PROMPT)),
			assistant("done with step 1"),
			user(wrapped("now do step 2")),
		]

		// The visible transcript has 2 user messages; the 2nd must map past the
		// hidden continuation to index 4, not index 2.
		expect(findSdkUserMessageIndexByOrdinal(messages, 2)).toBe(4)
	})

	it("skips task resumption prompts as persisted", () => {
		const messages = [
			user(wrapped("original task")),
			assistant("partial work"),
			user(wrapped("[TASK RESUMPTION] Please continue where you left off.")),
			assistant("resumed work"),
			user(wrapped("looks good, keep going")),
		]

		expect(findSdkUserMessageIndexByOrdinal(messages, 2)).toBe(4)
	})

	it("returns -1 when the ordinal exceeds the visible user messages", () => {
		const messages = [user("task"), user(ACT_MODE_CONTINUATION_PROMPT)]

		expect(findSdkUserMessageIndexByOrdinal(messages, 2)).toBe(-1)
	})

	it("counts an attachment-only continuation because it has a visible bubble", () => {
		// Attachment-only plan -> act toggle: the SDK message carries the canned
		// prompt text plus the user's image, and the webview shows a user_feedback
		// bubble for the attachment, so the message must be counted.
		const messages = [
			user(wrapped("plan the auth refactor", "plan")),
			assistant("here is the plan"),
			{
				role: "user",
				content: [
					{ type: "text", text: wrapped(ACT_MODE_CONTINUATION_PROMPT) },
					{ type: "image", mediaType: "image/png", data: "abc" },
				],
			},
			assistant("done with step 1"),
			user(wrapped("now do step 2")),
		]

		expect(findSdkUserMessageIndexByOrdinal(messages, 2)).toBe(2)
		expect(findSdkUserMessageIndexByOrdinal(messages, 3)).toBe(4)
	})

	it("counts attachment-only user messages with no text", () => {
		const messages = [
			user("task"),
			{
				role: "user",
				content: [{ type: "image", mediaType: "image/png", data: "abc" }],
			},
		]

		expect(findSdkUserMessageIndexByOrdinal(messages, 2)).toBe(1)
	})

	it("does not count tool results even when they carry media blocks", () => {
		const messages = [
			user("task"),
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "t1" },
					{ type: "image", mediaType: "image/png", data: "screenshot" },
				],
			},
			user("follow-up"),
		]

		expect(findSdkUserMessageIndexByOrdinal(messages, 2)).toBe(2)
	})
})

describe("extractSdkUserText", () => {
	it("extracts text from string and block content", () => {
		expect(extractSdkUserText({ role: "user", content: "  hello  " })).toBe("hello")
		expect(
			extractSdkUserText({
				role: "user",
				content: [
					{ type: "text", text: "first" },
					{ type: "file", content: "second" },
					{ type: "image", source: "ignored" },
				],
			}),
		).toBe("first\nsecond")
		expect(extractSdkUserText({ role: "user", content: 42 })).toBe("")
	})
})
