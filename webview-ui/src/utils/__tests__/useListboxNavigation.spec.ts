import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useListboxNavigation } from "../useListboxNavigation"

describe("useListboxNavigation", () => {
	it("should initialize with selectedIndex at 0", () => {
		const { result } = renderHook(() =>
			useListboxNavigation({
				itemCount: 5,
				isOpen: true,
			}),
		)

		expect(result.current.selectedIndex).toBe(0)
	})

	it("should navigate down with ArrowDown", () => {
		const { result } = renderHook(() =>
			useListboxNavigation({
				itemCount: 5,
				isOpen: true,
			}),
		)

		const event = { key: "ArrowDown", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		act(() => {
			result.current.handleKeyDown(event)
		})

		expect(result.current.selectedIndex).toBe(1)
		expect(event.preventDefault).toHaveBeenCalled()
	})

	it("should navigate up with ArrowUp", () => {
		const { result } = renderHook(() =>
			useListboxNavigation({
				itemCount: 5,
				isOpen: true,
			}),
		)

		act(() => {
			result.current.setSelectedIndex(2)
		})

		const event = { key: "ArrowUp", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		act(() => {
			result.current.handleKeyDown(event)
		})

		expect(result.current.selectedIndex).toBe(1)
	})

	it("should not go below 0 without loop", () => {
		const { result } = renderHook(() =>
			useListboxNavigation({
				itemCount: 5,
				isOpen: true,
				loop: false,
			}),
		)

		const event = { key: "ArrowUp", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		act(() => {
			result.current.handleKeyDown(event)
		})

		expect(result.current.selectedIndex).toBe(0)
	})

	it("should not go above itemCount-1 without loop", () => {
		const { result } = renderHook(() =>
			useListboxNavigation({
				itemCount: 3,
				isOpen: true,
				loop: false,
			}),
		)

		act(() => {
			result.current.setSelectedIndex(2)
		})

		const event = { key: "ArrowDown", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		act(() => {
			result.current.handleKeyDown(event)
		})

		expect(result.current.selectedIndex).toBe(2)
	})

	it("should loop from last to first with ArrowDown when loop=true", () => {
		const { result } = renderHook(() =>
			useListboxNavigation({
				itemCount: 3,
				isOpen: true,
				loop: true,
			}),
		)

		act(() => {
			result.current.setSelectedIndex(2)
		})

		const event = { key: "ArrowDown", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		act(() => {
			result.current.handleKeyDown(event)
		})

		expect(result.current.selectedIndex).toBe(0)
	})

	it("should loop from first to last with ArrowUp when loop=true", () => {
		const { result } = renderHook(() =>
			useListboxNavigation({
				itemCount: 3,
				isOpen: true,
				loop: true,
			}),
		)

		const event = { key: "ArrowUp", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		act(() => {
			result.current.handleKeyDown(event)
		})

		expect(result.current.selectedIndex).toBe(2)
	})

	it("should go to first with Home key", () => {
		const { result } = renderHook(() =>
			useListboxNavigation({
				itemCount: 5,
				isOpen: true,
			}),
		)

		act(() => {
			result.current.setSelectedIndex(3)
		})

		const event = { key: "Home", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		act(() => {
			result.current.handleKeyDown(event)
		})

		expect(result.current.selectedIndex).toBe(0)
	})

	it("should go to last with End key", () => {
		const { result } = renderHook(() =>
			useListboxNavigation({
				itemCount: 5,
				isOpen: true,
			}),
		)

		const event = { key: "End", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		act(() => {
			result.current.handleKeyDown(event)
		})

		expect(result.current.selectedIndex).toBe(4)
	})

	it("should call onSelect with Enter key", () => {
		const onSelect = vi.fn()
		const { result } = renderHook(() =>
			useListboxNavigation({
				itemCount: 5,
				isOpen: true,
				onSelect,
			}),
		)

		act(() => {
			result.current.setSelectedIndex(2)
		})

		const event = { key: "Enter", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		act(() => {
			result.current.handleKeyDown(event)
		})

		expect(onSelect).toHaveBeenCalledWith(2)
		expect(event.preventDefault).toHaveBeenCalled()
	})

	it("should call onClose with Escape key", () => {
		const onClose = vi.fn()
		const { result } = renderHook(() =>
			useListboxNavigation({
				itemCount: 5,
				isOpen: true,
				onClose,
			}),
		)

		const event = { key: "Escape", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		act(() => {
			result.current.handleKeyDown(event)
		})

		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it("should not handle keys when closed", () => {
		const onSelect = vi.fn()
		const { result } = renderHook(() =>
			useListboxNavigation({
				itemCount: 5,
				isOpen: false,
				onSelect,
			}),
		)

		const event = { key: "Enter", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		act(() => {
			result.current.handleKeyDown(event)
		})

		expect(onSelect).not.toHaveBeenCalled()
	})

	it("should not handle keys when itemCount is 0", () => {
		const onSelect = vi.fn()
		const { result } = renderHook(() =>
			useListboxNavigation({
				itemCount: 0,
				isOpen: true,
				onSelect,
			}),
		)

		const event = { key: "Enter", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		act(() => {
			result.current.handleKeyDown(event)
		})

		expect(onSelect).not.toHaveBeenCalled()
	})

	it("should reset selection with resetSelection", () => {
		const { result } = renderHook(() =>
			useListboxNavigation({
				itemCount: 5,
				isOpen: true,
			}),
		)

		act(() => {
			result.current.setSelectedIndex(3)
		})
		expect(result.current.selectedIndex).toBe(3)

		act(() => {
			result.current.resetSelection()
		})
		expect(result.current.selectedIndex).toBe(0)
	})

	it("should update handleKeyDown when itemCount changes", () => {
		const { result, rerender } = renderHook(({ itemCount }) => useListboxNavigation({ itemCount, isOpen: true }), {
			initialProps: { itemCount: 3 },
		})

		act(() => {
			result.current.setSelectedIndex(2)
		})

		rerender({ itemCount: 5 })

		const event = { key: "ArrowDown", preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>
		act(() => {
			result.current.handleKeyDown(event)
		})

		expect(result.current.selectedIndex).toBe(3)
	})
})
