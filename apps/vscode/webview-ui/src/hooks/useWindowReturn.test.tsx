import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useWindowReturn } from "./useWindowReturn"

function setVisibility(state: DocumentVisibilityState) {
	Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state })
}

describe("useWindowReturn", () => {
	afterEach(() => {
		vi.useRealTimers()
		setVisibility("visible")
	})

	it("runs once for a return reported as both focus and visibilitychange, and again for a later return", () => {
		vi.useFakeTimers()
		const onReturn = vi.fn()
		renderHook(() => useWindowReturn(onReturn))

		act(() => {
			document.dispatchEvent(new Event("visibilitychange"))
			window.dispatchEvent(new Event("focus"))
		})
		expect(onReturn).toHaveBeenCalledTimes(1)

		act(() => {
			vi.advanceTimersByTime(1_000)
			window.dispatchEvent(new Event("focus"))
		})
		expect(onReturn).toHaveBeenCalledTimes(2)
	})

	it("ignores the change that hides the webview", () => {
		const onReturn = vi.fn()
		renderHook(() => useWindowReturn(onReturn))

		setVisibility("hidden")
		act(() => {
			document.dispatchEvent(new Event("visibilitychange"))
		})
		expect(onReturn).not.toHaveBeenCalled()
	})

	it("uses the latest callback and stops listening when given none", () => {
		const first = vi.fn()
		const second = vi.fn()
		const { rerender } = renderHook(({ cb }: { cb?: () => void }) => useWindowReturn(cb), {
			initialProps: { cb: first as (() => void) | undefined },
		})

		rerender({ cb: second })
		act(() => {
			window.dispatchEvent(new Event("focus"))
		})
		expect(first).not.toHaveBeenCalled()
		expect(second).toHaveBeenCalledTimes(1)

		rerender({ cb: undefined })
		act(() => {
			window.dispatchEvent(new Event("focus"))
		})
		expect(second).toHaveBeenCalledTimes(1)
	})
})
