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
 * A list jsdom can be measured against: jsdom has no layout, so `scrollHeight`/`clientHeight`/
 * `scrollTop` live in plain objects behind accessors and every row reports a rectangle computed
 * from that model — viewport-relative, exactly like a browser's.
 */
function fakeList(rows: Array<{ ts: number; height: number }>, viewport: { clientHeight: number; scrollTop: number }) {
	const element = document.createElement("div")
	element.className = "chat-scrollbar"
	const model = rows.map((row) => ({ ...row }))
	const clientHeight = viewport.clientHeight
	let scrollTop = viewport.scrollTop

	const documentTop = (ts: number) => {
		let offset = 0
		for (const row of model) {
			if (row.ts === ts) {
				return offset
			}
			offset += row.height
		}
		return offset
	}
	const rect = (top: number, height: number): DOMRect =>
		({ bottom: top + height, height, left: 0, right: 0, top, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

	for (const row of model) {
		const node = document.createElement("div")
		node.dataset.messageTs = String(row.ts)
		node.getBoundingClientRect = () => rect(documentTop(row.ts) - scrollTop, row.height)
		element.append(node)
	}
	Object.defineProperty(element, "clientHeight", { get: () => clientHeight, configurable: true })
	Object.defineProperty(element, "scrollHeight", {
		get: () => model.reduce((sum, row) => sum + row.height, 0),
		configurable: true,
	})
	Object.defineProperty(element, "scrollTop", {
		get: () => scrollTop,
		set: (value: number) => {
			scrollTop = value
		},
		configurable: true,
	})
	element.getBoundingClientRect = () => rect(0, clientHeight)
	document.body.append(element)
	mounted.push(element)

	return {
		element,
		get scrollTop() {
			return scrollTop
		},
		set scrollTop(value: number) {
			scrollTop = value
		},
		/** Something above changed height: every later row moves down by `by`. */
		growRow(ts: number, by: number) {
			const row = model.find((candidate) => candidate.ts === ts)
			if (row) {
				row.height += by
			}
		},
	}
}

/** Mounts the hook against an element and commits once, so the lock stores its baseline. */
function mountWith(element: HTMLElement) {
	const rendered = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
	rendered.result.current.scrollContainerRef.current = element
	rendered.rerender()
	return rendered
}

/** 1200 px of content in a 300 px viewport, so each row can be the anchor in turn. */
const THREE_ROWS = () => [
	{ ts: 1, height: 400 },
	{ ts: 2, height: 400 },
	{ ts: 3, height: 400 },
]

/** Row 2 at the top of the viewport, 450 px above the tail. */
const READING = { clientHeight: 300, scrollTop: 450 }

/** A bare scroller without rows, for the follow-flag tests that only need geometry. */
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
		const scroller = fakeScroller({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 })
		const { element, geometry } = scroller
		const { result } = mountWith(element)

		// A scrollbar drag, PageUp or a swipe: none of them is a wheel, all of them leave the tail.
		geometry.scrollTop = 100
		element.dispatchEvent(new Event("scroll"))
		expect(result.current.disableAutoScrollRef.current).toBe(true)

		// Back at the tail, following is armed again.
		geometry.scrollTop = 600
		element.dispatchEvent(new Event("scroll"))
		expect(result.current.disableAutoScrollRef.current).toBe(false)
	})

	it("holds the reading position when content above grows", () => {
		const list = fakeList(THREE_ROWS(), READING)
		const { rerender } = mountWith(list.element) // anchor: row 2, 400 px into the document

		list.growRow(1, 50)
		rerender()

		// The row under the eyes stays under the eyes instead of sliding down by 50.
		expect(list.scrollTop).toBe(500)
	})

	it("does not fight a wheel tick inside the same row", () => {
		const list = fakeList(THREE_ROWS(), READING)
		const { rerender } = mountWith(list.element)

		// Scrolling cannot change a row's document offset, so there is nothing to correct — this is
		// what kept the old distance-based lock from letting the wheel move at all.
		list.scrollTop = 240
		rerender()

		expect(list.scrollTop).toBe(240)
	})

	it("re-baselines when the reader moves to another row", () => {
		const list = fakeList(THREE_ROWS(), READING)
		const { rerender } = mountWith(list.element)

		list.scrollTop = 120
		rerender()

		expect(list.scrollTop).toBe(120)
	})

	it("leaves the tail alone for the scroll handlers to follow", () => {
		const list = fakeList(THREE_ROWS(), { clientHeight: 300, scrollTop: 900 })
		const { rerender } = mountWith(list.element)

		// Pinned to the bottom: output arriving there is the point, so no correction.
		list.growRow(1, 50)
		rerender()

		expect(list.scrollTop).toBe(900)
	})

	it("stands down while a programmatic scroll owns the scroller", () => {
		const list = fakeList(THREE_ROWS(), READING)
		const { result, rerender } = mountWith(list.element)

		act(() => {
			result.current.notifyProgrammaticScroll()
		})
		list.growRow(1, 50)
		rerender()

		// A timeline jump lands somewhere new; correcting mid-flight would undo it.
		expect(list.scrollTop).toBe(450)
	})
})
