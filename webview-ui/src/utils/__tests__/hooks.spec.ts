import { renderHook } from "@testing-library/react"
import { useShortcut } from "../hooks"
import { vi } from "vitest"

describe("useShortcut", () => {
	it("should call the callback when the shortcut is pressed", () => {
		const callback = vi.fn()
		renderHook(() => useShortcut("Control+s", callback))

		const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true })
		window.dispatchEvent(event)

		expect(callback).toHaveBeenCalled()
	})

	it("should not call the callback when the shortcut is not pressed", () => {
		const callback = vi.fn()
		renderHook(() => useShortcut("Control+s", callback))

		const event = new KeyboardEvent("keydown", { key: "a", ctrlKey: true })
		window.dispatchEvent(event)

		expect(callback).not.toHaveBeenCalled()
	})

	it("should not call the callback when typing in a text input when disableTextInputs is true", () => {
		const callback = vi.fn()
		renderHook(() => useShortcut("Control+s", callback, { disableTextInputs: true }))

		const input = document.createElement("input")
		document.body.appendChild(input)
		input.focus()

		const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true })
		input.dispatchEvent(event)

		expect(callback).not.toHaveBeenCalled()

		document.body.removeChild(input)
	})
})
