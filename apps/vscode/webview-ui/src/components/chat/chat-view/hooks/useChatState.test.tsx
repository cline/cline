import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useChatState } from "./useChatState"

describe("useChatState draft snapshots", () => {
	it("snapshots a mutation immediately, before React renders again", () => {
		const { result } = renderHook(() => useChatState([]))
		let snapshot = result.current.getDraftSnapshot()

		act(() => {
			result.current.setInputValue("latest text")
			snapshot = result.current.getDraftSnapshot()
		})

		expect(snapshot.text).toBe("latest text")
		expect(snapshot.revision).toBeGreaterThan(0)
	})

	it("consumes an acknowledged snapshot when the draft has not changed", () => {
		const { result } = renderHook(() => useChatState([]))

		act(() => {
			result.current.setInputValue("feedback")
			result.current.setActiveQuote("selected context")
			result.current.setSelectedImages(["image.png"])
			result.current.setSelectedFiles(["notes.md"])
		})
		const snapshot = result.current.getDraftSnapshot()

		act(() => result.current.consumeDraftSnapshot(snapshot))

		expect(result.current.inputValue).toBe("")
		expect(result.current.activeQuote).toBeNull()
		expect(result.current.selectedImages).toEqual([])
		expect(result.current.selectedFiles).toEqual([])
	})

	it("preserves a newer draft even when its text returns to the submitted value", () => {
		const { result } = renderHook(() => useChatState([]))

		act(() => result.current.setInputValue("same text"))
		const submitted = result.current.getDraftSnapshot()
		act(() => {
			result.current.setInputValue("different text")
			result.current.setInputValue("same text")
		})

		act(() => result.current.consumeDraftSnapshot(submitted))

		expect(result.current.inputValue).toBe("same text")
	})
})
