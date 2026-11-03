import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { landRowBelow } from "./useTurnNavigation"

/**
 * A scroller whose rows report viewport-relative rects, which is all the landing correction reads.
 * jsdom has no layout, so the geometry is a plain number behind `scrollTop`.
 */
function fakeScroller(rows: Array<{ ts: number; documentTop: number; height: number }>) {
	const element = document.createElement("div")
	element.className = "chat-scrollbar"
	let scrollTop = 0
	Object.defineProperty(element, "scrollTop", {
		get: () => scrollTop,
		set: (value: number) => {
			scrollTop = value
		},
		configurable: true,
	})
	const rect = (top: number, height: number): DOMRect =>
		({ bottom: top + height, height, left: 0, right: 0, top, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
	element.getBoundingClientRect = () => rect(0, 400)

	for (const row of rows) {
		const node = document.createElement("div")
		node.dataset.messageTs = String(row.ts)
		node.getBoundingClientRect = () => rect(row.documentTop - scrollTop, row.height)
		element.append(node)
	}
	document.body.append(element)
	return {
		element,
		get scrollTop() {
			return scrollTop
		},
	}
}

let frames: FrameRequestCallback[] = []

/** Runs the queued frames until the correction settles (or its frame budget runs out). */
function flushFrames(limit = 40) {
	for (let index = 0; index < limit && frames.length > 0; index++) {
		const frame = frames.shift() as FrameRequestCallback
		frame(0)
	}
}

describe("landRowBelow", () => {
	beforeEach(() => {
		frames = []
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback)
			return frames.length
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		document.body.innerHTML = ""
	})

	it("lands the row below the pinned prompt instead of under it", () => {
		// The virtualiser's estimate put the row 120 px too far up; only the rect knows.
		const scroller = fakeScroller([{ ts: 42, documentTop: 5000, height: 200 }])
		scroller.element.scrollTop = 5000 - 120

		landRowBelow(scroller.element, 42, 40)
		flushFrames()

		expect(scroller.scrollTop).toBe(5000 - 40)
	})

	it("waits for the virtualiser to build the row", () => {
		const scroller = fakeScroller([])
		scroller.element.scrollTop = 100

		landRowBelow(scroller.element, 7, 40)
		flushFrames(2)
		// Still missing after two frames: nothing has been written, the wait continues.
		expect(scroller.scrollTop).toBe(100)

		const late = document.createElement("div")
		late.dataset.messageTs = "7"
		late.getBoundingClientRect = () =>
			({ top: 900 - scroller.scrollTop, bottom: 1000 - scroller.scrollTop, height: 100 }) as DOMRect
		scroller.element.append(late)

		flushFrames()
		expect(scroller.scrollTop).toBe(900 - 40)
	})

	it("stops once the row is where it belongs", () => {
		const scroller = fakeScroller([{ ts: 3, documentTop: 800, height: 100 }])
		scroller.element.scrollTop = 800 - 40

		landRowBelow(scroller.element, 3, 40)
		flushFrames()

		expect(scroller.scrollTop).toBe(760)
		expect(frames).toHaveLength(0)
	})
})
