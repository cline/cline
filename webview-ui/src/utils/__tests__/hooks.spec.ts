import { renderHook } from "@testing-library/react"
import { vi } from "vitest"
import { useMetaKeyDetection, useShortcut } from "../hooks"

describe("useShortcut", () => {
	it("should call the callback when the shortcut is pressed", () => {
		const callback = vi.fn()
		renderHook(() => useShortcut("Meta+Shift+a", callback))

		const event = new KeyboardEvent("keydown", { key: "a", metaKey: true, shiftKey: true })
		window.dispatchEvent(event)

		expect(callback).toHaveBeenCalled()
	})

	it("should not call the callback when the shortcut is not pressed", () => {
		const callback = vi.fn()
		renderHook(() => useShortcut("Command+Shift+b", callback))

		const event = new KeyboardEvent("keydown", { key: "a", metaKey: true, shiftKey: true })
		window.dispatchEvent(event)

		expect(callback).not.toHaveBeenCalled()
	})

	it("should not call the callback when typing in a text input when disableTextInputs is true", () => {
		const callback = vi.fn()
		renderHook(() => useShortcut("Meta+Shift+a", callback, { disableTextInputs: true }))

		const input = document.createElement("input")
		document.body.appendChild(input)
		input.focus()

		const event = new KeyboardEvent("keydown", { key: "a", metaKey: true, shiftKey: true })
		input.dispatchEvent(event)

		expect(callback).not.toHaveBeenCalled()

		document.body.removeChild(input)
	})
})

describe("useMetaKeyDetection", () => {
	it("should detect Windows OS and metaKey from platform", () => {
		// mock the detect functions
		const { result } = renderHook(() => useMetaKeyDetection("win32"))
		expect(result.current[0]).toBe("windows")
		expect(result.current[1]).toBe("Win")
	})

	it("should detect Mac OS and metaKey from platform", () => {
		// mock the detect functions
		const { result } = renderHook(() => useMetaKeyDetection("darwin"))
		expect(result.current[0]).toBe("mac")
		expect(result.current[1]).toBe("CMD")
	})

	it("should detect Linux OS and metaKey from platform", () => {
		// mock the detect functions
		const { result } = renderHook(() => useMetaKeyDetection("linux"))
		expect(result.current[0]).toBe("linux")
		expect(result.current[1]).toBe("Alt")
	})
})
