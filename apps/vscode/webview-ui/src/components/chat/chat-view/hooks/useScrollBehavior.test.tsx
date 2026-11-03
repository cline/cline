import { act, renderHook } from "@testing-library/react"
import type { MutableRefObject } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useScrollBehavior } from "./useScrollBehavior"

const commandMessage = {
	ts: 1,
	type: "ask",
	ask: "command",
	text: "echo hi",
}

let mounted: HTMLElement[] = []

/**
 * A scroller jsdom lets the code scroll: jsdom has no layout, so `scrollTop` would swallow every
 * write and `scrollHeight` would stay 0. Geometry lives in a plain object behind accessors.
 */
function fakeScroller(geometry: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
	const element = document.createElement("div")
	element.className = "chat-scrollbar"
	for (const key of ["scrollHeight", "clientHeight"] as const) {
		Object.defineProperty(element, key, { get: () => geometry[key], configurable: true })
	}
	Object.defineProperty(element, "scrollTop", {
		get: () => geometry.scrollTop,
		set: (value: number) => {
			geometry.scrollTop = value
		},
		configurable: true,
	})
	// Scroll events do not bubble; the hook listens in the window's capture phase, which needs the
	// target to be part of the document.
	document.body.append(element)
	mounted.push(element)
	return { element, geometry }
}

/** Mounts the hook against a fake scroller and commits once, so the lock stores its baseline. */
function withScroller(geometry: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
	const rendered = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
	const scroller = fakeScroller(geometry)
	rendered.result.current.scrollContainerRef.current = scroller.element
	rendered.rerender()
	return { ...rendered, ...scroller }
}

describe("useScrollBehavior", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		for (const element of mounted) {
			element.remove()
		}
		mounted = []
	})

	it("scrolls to bottom after command output layout has been quiet for 500ms", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
		const scrollTo = vi.fn()
		act(() => {
			vi.runOnlyPendingTimers()
		})
		;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = { scrollTo }

		act(() => {
			result.current.handleLastRowContentChange()
		})

		expect(scrollTo).not.toHaveBeenCalled()

		act(() => {
			vi.advanceTimersByTime(499)
		})
		expect(scrollTo).not.toHaveBeenCalled()

		act(() => {
			vi.advanceTimersByTime(1)
		})
		expect(scrollTo).toHaveBeenCalledWith({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "smooth",
		})
	})

	it("resets the 500ms wait when another command output change arrives", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
		const scrollTo = vi.fn()
		act(() => {
			vi.runOnlyPendingTimers()
		})
		;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = { scrollTo }

		act(() => {
			result.current.handleLastRowContentChange()
			scrollTo.mockClear()
			vi.advanceTimersByTime(400)
			result.current.handleLastRowContentChange()
			scrollTo.mockClear()
			vi.advanceTimersByTime(499)
		})
		expect(scrollTo).not.toHaveBeenCalled()

		act(() => {
			vi.advanceTimersByTime(1)
		})
		expect(scrollTo).toHaveBeenCalledWith({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "smooth",
		})
	})

	it("does not re-pin command output changes after auto-scroll is disabled", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
		const scrollTo = vi.fn()
		;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = { scrollTo }

		act(() => {
			result.current.disableAutoScrollRef.current = true
			result.current.handleLastRowContentChange()
			vi.runAllTimers()
		})

		expect(scrollTo).not.toHaveBeenCalled()
	})

	it("disables auto-scroll when a user expands a row", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [commandMessage as any], {}, vi.fn()))

		act(() => {
			result.current.toggleRowExpansion(commandMessage.ts)
		})

		expect(result.current.disableAutoScrollRef.current).toBe(true)
	})

	it("keeps auto-scroll enabled when command output expands programmatically", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [commandMessage as any], {}, vi.fn()))

		act(() => {
			result.current.toggleRowExpansion(commandMessage.ts, { preserveAutoScroll: true })
		})

		expect(result.current.disableAutoScrollRef.current).toBe(false)
	})

	it("stops following for any way of leaving the tail, not only the wheel", () => {
		const { element, geometry, result } = withScroller({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 })

		// A scrollbar drag, PageUp or a swipe: none of them is a wheel, all of them leave the tail.
		geometry.scrollTop = 100
		element.dispatchEvent(new Event("scroll"))
		expect(result.current.disableAutoScrollRef.current).toBe(true)

		// Back at the tail, following is armed again.
		geometry.scrollTop = 600
		element.dispatchEvent(new Event("scroll"))
		expect(result.current.disableAutoScrollRef.current).toBe(false)
	})

	it("holds the reading position when the content height changes", () => {
		const { geometry, rerender } = withScroller({ scrollHeight: 2000, clientHeight: 500, scrollTop: 800 })

		// 700 px above the tail. Something grew — a fold opening, a row re-measuring.
		geometry.scrollHeight = 2300
		rerender()

		// The distance is restored, so the text under the eyes stays where it was.
		expect(geometry.scrollTop).toBe(2300 - 500 - 700)
	})

	it("leaves the tail alone for the scroll handlers to follow", () => {
		const { geometry, rerender } = withScroller({ scrollHeight: 2000, clientHeight: 500, scrollTop: 1500 })

		// Pinned: output arriving below must not be countered, that is what following means.
		geometry.scrollHeight = 2400
		rerender()

		expect(geometry.scrollTop).toBe(1500)
	})

	it("does nothing when the content did not change", () => {
		const { geometry, rerender } = withScroller({ scrollHeight: 2000, clientHeight: 500, scrollTop: 800 })

		// A hover or a re-render moves the reader, it does not move the content.
		geometry.scrollTop = 400
		rerender()

		expect(geometry.scrollTop).toBe(400)
	})

	it("stands down while a programmatic scroll owns the scroller", () => {
		const { geometry, result, rerender } = withScroller({ scrollHeight: 2000, clientHeight: 500, scrollTop: 800 })

		act(() => {
			result.current.notifyProgrammaticScroll()
		})
		geometry.scrollHeight = 2300
		rerender()

		// A timeline jump lands somewhere new; restoring the old distance would undo it.
		expect(geometry.scrollTop).toBe(800)
	})
})
