import { renderHook } from "@testing-library/react"

import { useEscapeKey } from "./useEscapeKey"

describe("useEscapeKey", () => {
	let mockOnEscape: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockOnEscape = vi.fn()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("should call onEscape when Escape key is pressed and isOpen is true", () => {
		renderHook(() => useEscapeKey(true, mockOnEscape))

		const event = new KeyboardEvent("keydown", { key: "Escape" })
		window.dispatchEvent(event)

		expect(mockOnEscape).toHaveBeenCalledTimes(1)
	})

	it("should not call onEscape when Escape key is pressed and isOpen is false", () => {
		renderHook(() => useEscapeKey(false, mockOnEscape))

		const event = new KeyboardEvent("keydown", { key: "Escape" })
		window.dispatchEvent(event)

		expect(mockOnEscape).not.toHaveBeenCalled()
	})

	it("should not call onEscape when a different key is pressed", () => {
		renderHook(() => useEscapeKey(true, mockOnEscape))

		const event = new KeyboardEvent("keydown", { key: "Enter" })
		window.dispatchEvent(event)

		expect(mockOnEscape).not.toHaveBeenCalled()
	})

	it("should prevent default when preventDefault option is true", () => {
		renderHook(() => useEscapeKey(true, mockOnEscape, { preventDefault: true }))

		const event = new KeyboardEvent("keydown", { key: "Escape" })
		const preventDefaultSpy = vi.spyOn(event, "preventDefault")
		window.dispatchEvent(event)

		expect(preventDefaultSpy).toHaveBeenCalled()
	})

	it("should not prevent default when preventDefault option is false", () => {
		renderHook(() => useEscapeKey(true, mockOnEscape, { preventDefault: false }))

		const event = new KeyboardEvent("keydown", { key: "Escape" })
		const preventDefaultSpy = vi.spyOn(event, "preventDefault")
		window.dispatchEvent(event)

		expect(preventDefaultSpy).not.toHaveBeenCalled()
	})

	it("should stop propagation when stopPropagation option is true", () => {
		renderHook(() => useEscapeKey(true, mockOnEscape, { stopPropagation: true }))

		const event = new KeyboardEvent("keydown", { key: "Escape" })
		const stopPropagationSpy = vi.spyOn(event, "stopPropagation")
		window.dispatchEvent(event)

		expect(stopPropagationSpy).toHaveBeenCalled()
	})

	it("should not stop propagation when stopPropagation option is false", () => {
		renderHook(() => useEscapeKey(true, mockOnEscape, { stopPropagation: false }))

		const event = new KeyboardEvent("keydown", { key: "Escape" })
		const stopPropagationSpy = vi.spyOn(event, "stopPropagation")
		window.dispatchEvent(event)

		expect(stopPropagationSpy).not.toHaveBeenCalled()
	})

	it("should remove event listener on unmount", () => {
		const addEventListenerSpy = vi.spyOn(window, "addEventListener")
		const removeEventListenerSpy = vi.spyOn(window, "removeEventListener")

		const { unmount } = renderHook(() => useEscapeKey(true, mockOnEscape))

		expect(addEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function))

		unmount()

		expect(removeEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function))
	})

	it("should always add event listener regardless of isOpen state", () => {
		const addEventListenerSpy = vi.spyOn(window, "addEventListener")
		const removeEventListenerSpy = vi.spyOn(window, "removeEventListener")

		// Test with isOpen = false
		const { rerender } = renderHook(({ isOpen }) => useEscapeKey(isOpen, mockOnEscape), {
			initialProps: { isOpen: false },
		})

		expect(addEventListenerSpy).toHaveBeenCalledTimes(1)

		// Change to isOpen = true
		rerender({ isOpen: true })

		// The listener is re-added because handleKeyDown changes when isOpen changes
		// This is expected behavior - the old listener is removed and a new one is added
		expect(addEventListenerSpy).toHaveBeenCalledTimes(2)
		expect(removeEventListenerSpy).toHaveBeenCalledTimes(1)
	})

	it("should handle rapid isOpen state changes without memory leaks", () => {
		const addEventListenerSpy = vi.spyOn(window, "addEventListener")
		const removeEventListenerSpy = vi.spyOn(window, "removeEventListener")

		const { rerender, unmount } = renderHook(({ isOpen }) => useEscapeKey(isOpen, mockOnEscape), {
			initialProps: { isOpen: false },
		})

		// Initial render
		expect(addEventListenerSpy).toHaveBeenCalledTimes(1)

		// Rapid state changes
		rerender({ isOpen: true })
		rerender({ isOpen: false })
		rerender({ isOpen: true })

		// Each rerender causes the effect to re-run because handleKeyDown changes
		expect(addEventListenerSpy).toHaveBeenCalledTimes(4)
		// Each re-run also removes the previous listener
		expect(removeEventListenerSpy).toHaveBeenCalledTimes(3)

		// Unmount while isOpen is true
		unmount()

		// Should properly clean up the final listener
		expect(removeEventListenerSpy).toHaveBeenCalledTimes(4)

		// Verify that all listeners were properly cleaned up
		expect(addEventListenerSpy).toHaveBeenCalledTimes(removeEventListenerSpy.mock.calls.length)
	})

	it("should update callback when dependencies change", () => {
		const { rerender } = renderHook(({ isOpen, onEscape }) => useEscapeKey(isOpen, onEscape), {
			initialProps: { isOpen: true, onEscape: mockOnEscape },
		})

		const event = new KeyboardEvent("keydown", { key: "Escape" })
		window.dispatchEvent(event)

		expect(mockOnEscape).toHaveBeenCalledTimes(1)

		// Change the callback
		const newMockOnEscape = vi.fn()
		rerender({ isOpen: true, onEscape: newMockOnEscape })

		window.dispatchEvent(event)

		// Old callback should not be called again
		expect(mockOnEscape).toHaveBeenCalledTimes(1)
		// New callback should be called
		expect(newMockOnEscape).toHaveBeenCalledTimes(1)
	})
})
