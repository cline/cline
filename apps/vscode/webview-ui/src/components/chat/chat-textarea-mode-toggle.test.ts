import { describe, expect, it } from "vitest"
import { getModeToggleDraftAction } from "./chat-textarea-mode-toggle"

describe("chat textarea mode toggle draft handling", () => {
	it("clears only when the toggle consumed the submitted text", () => {
		expect(
			getModeToggleDraftAction({
				consumed: true,
				currentText: "draft message",
				submittedText: "draft message",
			}),
		).toBe("clear")

		expect(
			getModeToggleDraftAction({
				consumed: true,
				currentText: "draft message plus more",
				submittedText: "draft message",
			}),
		).toBe("keep")
	})

	it("restores a dropped draft after an unconsumed toggle", () => {
		expect(
			getModeToggleDraftAction({
				consumed: false,
				currentText: "",
				submittedText: "draft message",
			}),
		).toBe("restore")

		expect(
			getModeToggleDraftAction({
				consumed: false,
				currentText: "still here",
				submittedText: "draft message",
			}),
		).toBe("keep")

		expect(
			getModeToggleDraftAction({
				consumed: true,
				currentText: "",
				submittedText: "draft message",
			}),
		).toBe("keep")
	})
})
