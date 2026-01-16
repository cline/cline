import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useListboxNavigation } from "../useListboxNavigation"

describe("useListboxNavigation", () => {
	it("navigates with arrow keys", () => {
		const { result } = renderHook(() => useListboxNavigation({ itemCount: 5, isOpen: true }))

		act(() => {
			result.current.handleKeyDown({
				key: "ArrowDown",
				preventDefault: vi.fn(),
			} as unknown as React.KeyboardEvent<HTMLElement>)
		})
		expect(result.current.selectedIndex).toBe(1)

		act(() => {
			result.current.handleKeyDown({
				key: "ArrowUp",
				preventDefault: vi.fn(),
			} as unknown as React.KeyboardEvent<HTMLElement>)
		})
		expect(result.current.selectedIndex).toBe(0)
	})

	it("calls onSelect on Enter", () => {
		const onSelect = vi.fn()
		const { result } = renderHook(() => useListboxNavigation({ itemCount: 5, isOpen: true, onSelect }))

		act(() => {
			result.current.handleKeyDown({ key: "Enter", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>)
		})
		expect(onSelect).toHaveBeenCalledWith(0)
	})

	it("calls onClose on Escape", () => {
		const onClose = vi.fn()
		const { result } = renderHook(() => useListboxNavigation({ itemCount: 5, isOpen: true, onClose }))

		act(() => {
			result.current.handleKeyDown({
				key: "Escape",
				preventDefault: vi.fn(),
			} as unknown as React.KeyboardEvent<HTMLElement>)
		})
		expect(onClose).toHaveBeenCalled()
	})

	it("does not handle keys when closed", () => {
		const onSelect = vi.fn()
		const { result } = renderHook(() => useListboxNavigation({ itemCount: 5, isOpen: false, onSelect }))

		act(() => {
			result.current.handleKeyDown({ key: "Enter", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>)
		})
		expect(onSelect).not.toHaveBeenCalled()
	})
})
