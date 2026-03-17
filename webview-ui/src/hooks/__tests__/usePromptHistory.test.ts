import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const mockTaskHistory = [
	{ id: "1", ts: 1000, task: "first prompt", tokensIn: 0, tokensOut: 0, totalCost: 0 },
	{ id: "2", ts: 2000, task: "second prompt", tokensIn: 0, tokensOut: 0, totalCost: 0 },
	{ id: "3", ts: 3000, task: "third prompt", tokensIn: 0, tokensOut: 0, totalCost: 0 },
	{ id: "4", ts: 4000, task: "duplicate prompt", tokensIn: 0, tokensOut: 0, totalCost: 0 },
	{ id: "5", ts: 5000, task: "duplicate prompt", tokensIn: 0, tokensOut: 0, totalCost: 0 },
]

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		taskHistory: mockTaskHistory,
	}),
}))

import { usePromptHistory } from "../usePromptHistory"

describe("usePromptHistory", () => {
	it("navigateUp returns the most recent prompt first", () => {
		const { result } = renderHook(() => usePromptHistory())

		let nav: { text: string; handled: boolean }
		act(() => {
			nav = result.current.navigateUp("")
		})
		// Most recent first (reversed): "duplicate prompt" (deduped), "third prompt", "second prompt", "first prompt"
		expect(nav!.handled).toBe(true)
		expect(nav!.text).toBe("duplicate prompt")
	})

	it("navigateUp cycles through unique prompts", () => {
		const { result } = renderHook(() => usePromptHistory())

		// First up: most recent
		act(() => {
			result.current.navigateUp("")
		})

		// Second up: next unique
		let nav: { text: string; handled: boolean }
		act(() => {
			nav = result.current.navigateUp("duplicate prompt")
		})
		expect(nav!.text).toBe("third prompt")

		// Third up
		act(() => {
			nav = result.current.navigateUp("third prompt")
		})
		expect(nav!.text).toBe("second prompt")

		// Fourth up
		act(() => {
			nav = result.current.navigateUp("second prompt")
		})
		expect(nav!.text).toBe("first prompt")
	})

	it("navigateUp does not go past the oldest item", () => {
		const { result } = renderHook(() => usePromptHistory())

		// Navigate to the end
		act(() => {
			result.current.navigateUp("")
		})
		act(() => {
			result.current.navigateUp("duplicate prompt")
		})
		act(() => {
			result.current.navigateUp("third prompt")
		})
		act(() => {
			result.current.navigateUp("second prompt")
		})

		// Try going past
		let nav: { text: string; handled: boolean }
		act(() => {
			nav = result.current.navigateUp("first prompt")
		})
		expect(nav!.handled).toBe(false)
		expect(nav!.text).toBe("first prompt")
	})

	it("navigateDown returns to newer prompts and restores empty input", () => {
		const { result } = renderHook(() => usePromptHistory())

		// Navigate up from empty input
		let nav: { text: string; handled: boolean }
		act(() => {
			nav = result.current.navigateUp("")
		})
		expect(nav!.text).toBe("duplicate prompt")

		// Navigate up again
		act(() => {
			nav = result.current.navigateUp(nav!.text)
		})
		expect(nav!.text).toBe("third prompt")

		// Navigate down: back to most recent
		act(() => {
			nav = result.current.navigateDown(nav!.text)
		})
		expect(nav!.text).toBe("duplicate prompt")

		// Navigate down again: restore original (empty) input
		act(() => {
			nav = result.current.navigateDown(nav!.text)
		})
		expect(nav!.handled).toBe(true)
		expect(nav!.text).toBe("")
	})

	it("navigateDown does nothing when not in history mode", () => {
		const { result } = renderHook(() => usePromptHistory())

		let nav: { text: string; handled: boolean }
		act(() => {
			nav = result.current.navigateDown("some text")
		})
		expect(nav!.handled).toBe(false)
	})

	it("navigateUp does nothing when input has been modified", () => {
		const { result } = renderHook(() => usePromptHistory())

		// Navigate up
		act(() => {
			result.current.navigateUp("")
		})

		// User modifies the text, then tries up again
		let nav: { text: string; handled: boolean }
		act(() => {
			nav = result.current.navigateUp("modified text")
		})
		expect(nav!.handled).toBe(false)
	})

	it("resetHistory clears history navigation state", () => {
		const { result } = renderHook(() => usePromptHistory())

		// Navigate up
		act(() => {
			result.current.navigateUp("")
		})

		// Reset
		act(() => {
			result.current.resetHistory()
		})

		// navigateDown should do nothing since we reset
		let nav: { text: string; handled: boolean }
		act(() => {
			nav = result.current.navigateDown("duplicate prompt")
		})
		expect(nav!.handled).toBe(false)
	})
})
