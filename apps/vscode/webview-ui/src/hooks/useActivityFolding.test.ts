import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { isActivityFoldingEnabled, setActivityFoldingEnabled, useActivityFoldingEnabled } from "./useActivityFolding"

describe("useActivityFoldingEnabled", () => {
	beforeEach(() => {
		setActivityFoldingEnabled(true)
	})

	it("folds agent activities by default", () => {
		const { result } = renderHook(() => useActivityFoldingEnabled())

		expect(result.current[0]).toBe(true)
		expect(isActivityFoldingEnabled()).toBe(true)
	})

	it("switches the preference and re-renders every subscriber", () => {
		const first = renderHook(() => useActivityFoldingEnabled())
		const second = renderHook(() => useActivityFoldingEnabled())

		act(() => {
			first.result.current[1](false)
		})

		expect(first.result.current[0]).toBe(false)
		expect(second.result.current[0]).toBe(false)
		expect(isActivityFoldingEnabled()).toBe(false)

		act(() => {
			second.result.current[1](true)
		})
		expect(first.result.current[0]).toBe(true)
	})
})
