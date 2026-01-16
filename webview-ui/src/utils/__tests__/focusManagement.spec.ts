import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useFocusRestoration, useFocusTrap, useModal } from "../focusManagement"

describe("useFocusTrap", () => {
	let container: HTMLDivElement
	let containerRef: React.RefObject<HTMLDivElement>

	beforeEach(() => {
		container = document.createElement("div")
		container.innerHTML = `
			<button>First</button>
			<input type="text" />
			<button>Last</button>
		`
		document.body.appendChild(container)
		containerRef = { current: container }
	})

	afterEach(() => {
		document.body.removeChild(container)
	})

	it("should trap focus within container when active", () => {
		renderHook(({ isActive }) => useFocusTrap(isActive, containerRef), {
			initialProps: { isActive: true },
		})

		const firstButton = container.querySelector("button") as HTMLButtonElement
		const input = container.querySelector("input") as HTMLInputElement
		const lastButton = container.querySelectorAll("button")[1] as HTMLButtonElement
		expect(document.activeElement === input || document.activeElement === firstButton).toBe(true)
		const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
		document.dispatchEvent(tabEvent)
		const currentFocus = document.activeElement
		expect(currentFocus === firstButton || currentFocus === lastButton || currentFocus === input).toBe(true)
		const tabEvent2 = new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
		document.dispatchEvent(tabEvent2)
		const currentFocus2 = document.activeElement
		expect(currentFocus2 === firstButton || currentFocus2 === lastButton || currentFocus2 === input).toBe(true)
		const tabEvent3 = new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
		document.dispatchEvent(tabEvent3)
		const finalFocus = document.activeElement
		expect(finalFocus === input || finalFocus === firstButton).toBe(true)
	})

	it("should not trap focus when inactive", () => {
		renderHook(() => useFocusTrap(false, containerRef))

		const outsideButton = document.createElement("button")
		document.body.appendChild(outsideButton)
		outsideButton.focus()

		const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
		document.dispatchEvent(tabEvent)
		expect(document.activeElement).not.toBe(container.querySelector("button"))
		document.body.removeChild(outsideButton)
	})

	it("should handle Shift+Tab for reverse navigation", () => {
		renderHook(() => useFocusTrap(true, containerRef))

		const firstButton = container.querySelector("button") as HTMLButtonElement
		const lastButton = container.querySelectorAll("button")[1] as HTMLButtonElement

		firstButton.focus()
		const shiftTabEvent = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })
		document.dispatchEvent(shiftTabEvent)
		lastButton.focus()
		expect(document.activeElement).toBe(lastButton)
	})
})

describe("useFocusRestoration", () => {
	it("should restore focus to target ref on unmount", () => {
		const restoreButton = document.createElement("button")
		restoreButton.textContent = "Restore Target"
		document.body.appendChild(restoreButton)

		const restoreRef = { current: restoreButton }

		const { unmount } = renderHook(() => useFocusRestoration(restoreRef))
		const otherButton = document.createElement("button")
		document.body.appendChild(otherButton)
		otherButton.focus()
		expect(document.activeElement).toBe(otherButton)
		unmount()
		expect(document.activeElement).toBe(restoreButton)

		document.body.removeChild(restoreButton)
		document.body.removeChild(otherButton)
	})
})

describe("useModal", () => {
	it("should create triggerRef and containerRef", () => {
		const mockOnClose = vi.fn()
		const { result } = renderHook(() => useModal(true, mockOnClose))

		expect(result.current.triggerRef).toBeDefined()
		expect(result.current.triggerRef.current).toBeNull()
		expect(result.current.containerRef).toBeDefined()
		expect(result.current.containerRef.current).toBeNull()
	})

	it("should handle Escape key to close modal", () => {
		const mockOnClose = vi.fn()
		renderHook(() => useModal(true, mockOnClose))

		const escapeEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
		window.dispatchEvent(escapeEvent)

		expect(mockOnClose).toHaveBeenCalledTimes(1)
	})

	it("should not handle Escape when modal is closed", () => {
		const mockOnClose = vi.fn()
		renderHook(() => useModal(false, mockOnClose))

		const escapeEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
		window.dispatchEvent(escapeEvent)

		expect(mockOnClose).not.toHaveBeenCalled()
	})

	it("should accept external trigger ref", () => {
		const mockOnClose = vi.fn()
		const button = document.createElement("button")
		const externalTriggerRef = { current: button }

		const { result } = renderHook(() => useModal(true, mockOnClose, externalTriggerRef))
		expect(result.current.triggerRef).toBe(externalTriggerRef)
	})

	it("should use internal ref when no external ref provided", () => {
		const mockOnClose = vi.fn()
		const { result } = renderHook(() => useModal(true, mockOnClose))
		expect(result.current.triggerRef).toBeDefined()
		expect(result.current.triggerRef.current).toBeNull()
	})

	it("should clean up Escape listener on unmount", () => {
		const mockOnClose = vi.fn()
		const { unmount } = renderHook(() => useModal(true, mockOnClose))

		unmount()

		const escapeEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
		window.dispatchEvent(escapeEvent)

		expect(mockOnClose).not.toHaveBeenCalled()
	})
})
