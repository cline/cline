import { describe, expect, it } from "vitest"
import { shouldClearModeToggleDraft, shouldRestoreModeToggleDraft } from "./chat-textarea-mode-toggle"

describe("chat textarea mode toggle draft handling", () => {
	it("clears only when the toggle consumed the submitted text", () => {
		expect(
			shouldClearModeToggleDraft({
				consumed: true,
				currentText: "draft message",
				submittedText: "draft message",
			}),
		).toBe(true)

		expect(
			shouldClearModeToggleDraft({
				consumed: true,
				currentText: "draft message plus more",
				submittedText: "draft message",
			}),
		).toBe(false)
	})

	it("restores a dropped draft after an unconsumed toggle", () => {
		expect(
			shouldRestoreModeToggleDraft({
				consumed: false,
				currentText: "",
				submittedText: "draft message",
			}),
		).toBe(true)

		expect(
			shouldRestoreModeToggleDraft({
				consumed: false,
				currentText: "still here",
				submittedText: "draft message",
			}),
		).toBe(false)

		expect(
			shouldRestoreModeToggleDraft({
				consumed: true,
				currentText: "",
				submittedText: "draft message",
			}),
		).toBe(false)
	})
})
