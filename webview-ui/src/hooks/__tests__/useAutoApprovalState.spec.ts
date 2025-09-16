import { renderHook } from "@testing-library/react"
import { useAutoApprovalState } from "../useAutoApprovalState"

describe("useAutoApprovalState", () => {
	describe("hasEnabledOptions", () => {
		it("should return false when all toggles are false", () => {
			const toggles = {
				alwaysAllowReadOnly: false,
				alwaysAllowWrite: false,
				alwaysAllowExecute: false,
				alwaysAllowBrowser: false,
				alwaysAllowMcp: false,
				alwaysAllowModeSwitch: false,
				alwaysAllowSubtasks: false,
				alwaysApproveResubmit: false,
				alwaysAllowFollowupQuestions: false,
				alwaysAllowUpdateTodoList: false,
			}

			const { result } = renderHook(() => useAutoApprovalState(toggles, true))

			expect(result.current.hasEnabledOptions).toBe(false)
		})

		it("should return false when all toggles are undefined", () => {
			const toggles = {
				alwaysAllowReadOnly: undefined,
				alwaysAllowWrite: undefined,
				alwaysAllowExecute: undefined,
				alwaysAllowBrowser: undefined,
				alwaysAllowMcp: undefined,
				alwaysAllowModeSwitch: undefined,
				alwaysAllowSubtasks: undefined,
				alwaysApproveResubmit: undefined,
				alwaysAllowFollowupQuestions: undefined,
				alwaysAllowUpdateTodoList: undefined,
			}

			const { result } = renderHook(() => useAutoApprovalState(toggles, true))

			expect(result.current.hasEnabledOptions).toBe(false)
		})

		it("should return true when at least one toggle is true", () => {
			const toggles = {
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: false,
				alwaysAllowExecute: false,
				alwaysAllowBrowser: false,
				alwaysAllowMcp: false,
				alwaysAllowModeSwitch: false,
				alwaysAllowSubtasks: false,
				alwaysApproveResubmit: false,
				alwaysAllowFollowupQuestions: false,
				alwaysAllowUpdateTodoList: false,
			}

			const { result } = renderHook(() => useAutoApprovalState(toggles, true))

			expect(result.current.hasEnabledOptions).toBe(true)
		})

		it("should return true when multiple toggles are true", () => {
			const toggles = {
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: true,
				alwaysAllowExecute: true,
				alwaysAllowBrowser: false,
				alwaysAllowMcp: false,
				alwaysAllowModeSwitch: false,
				alwaysAllowSubtasks: false,
				alwaysApproveResubmit: false,
				alwaysAllowFollowupQuestions: false,
				alwaysAllowUpdateTodoList: false,
			}

			const { result } = renderHook(() => useAutoApprovalState(toggles, true))

			expect(result.current.hasEnabledOptions).toBe(true)
		})

		it("should return true when all toggles are true", () => {
			const toggles = {
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: true,
				alwaysAllowExecute: true,
				alwaysAllowBrowser: true,
				alwaysAllowMcp: true,
				alwaysAllowModeSwitch: true,
				alwaysAllowSubtasks: true,
				alwaysApproveResubmit: true,
				alwaysAllowFollowupQuestions: true,
				alwaysAllowUpdateTodoList: true,
			}

			const { result } = renderHook(() => useAutoApprovalState(toggles, true))

			expect(result.current.hasEnabledOptions).toBe(true)
		})
	})

	describe("effectiveAutoApprovalEnabled", () => {
		it("should return false when autoApprovalEnabled is false regardless of toggles", () => {
			const toggles = {
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: true,
				alwaysAllowExecute: true,
			}

			const { result } = renderHook(() => useAutoApprovalState(toggles, false))

			expect(result.current.effectiveAutoApprovalEnabled).toBe(false)
		})

		it("should return false when autoApprovalEnabled is undefined regardless of toggles", () => {
			const toggles = {
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: true,
				alwaysAllowExecute: true,
			}

			const { result } = renderHook(() => useAutoApprovalState(toggles, undefined))

			expect(result.current.effectiveAutoApprovalEnabled).toBe(false)
		})

		it("should return true when autoApprovalEnabled is true but no toggles are enabled", () => {
			const toggles = {
				alwaysAllowReadOnly: false,
				alwaysAllowWrite: false,
				alwaysAllowExecute: false,
				alwaysAllowBrowser: false,
				alwaysAllowMcp: false,
				alwaysAllowModeSwitch: false,
				alwaysAllowSubtasks: false,
				alwaysApproveResubmit: false,
				alwaysAllowFollowupQuestions: false,
				alwaysAllowUpdateTodoList: false,
			}

			const { result } = renderHook(() => useAutoApprovalState(toggles, true))

			expect(result.current.effectiveAutoApprovalEnabled).toBe(true)
		})

		it("should return true when autoApprovalEnabled is true and at least one toggle is enabled", () => {
			const toggles = {
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: false,
				alwaysAllowExecute: false,
			}

			const { result } = renderHook(() => useAutoApprovalState(toggles, true))

			expect(result.current.effectiveAutoApprovalEnabled).toBe(true)
		})
	})

	describe("memoization", () => {
		it("should not recompute hasEnabledOptions when toggles object reference changes but values are the same", () => {
			const initialToggles = {
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: false,
			}

			const { result, rerender } = renderHook(
				({ toggles, autoApprovalEnabled }) => useAutoApprovalState(toggles, autoApprovalEnabled),
				{
					initialProps: {
						toggles: initialToggles,
						autoApprovalEnabled: true,
					},
				},
			)

			const firstHasEnabledOptions = result.current.hasEnabledOptions
			const firstEffectiveAutoApprovalEnabled = result.current.effectiveAutoApprovalEnabled

			// Create new object with same values
			const newToggles = {
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: false,
			}

			rerender({ toggles: newToggles, autoApprovalEnabled: true })

			// The computed values should be the same due to memoization
			expect(result.current.hasEnabledOptions).toBe(firstHasEnabledOptions)
			expect(result.current.effectiveAutoApprovalEnabled).toBe(firstEffectiveAutoApprovalEnabled)
		})

		it("should recompute when toggle values change", () => {
			const initialToggles = {
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: false,
			}

			const { result, rerender } = renderHook(
				({ toggles, autoApprovalEnabled }) => useAutoApprovalState(toggles, autoApprovalEnabled),
				{
					initialProps: {
						toggles: initialToggles,
						autoApprovalEnabled: true,
					},
				},
			)

			expect(result.current.hasEnabledOptions).toBe(true)
			expect(result.current.effectiveAutoApprovalEnabled).toBe(true)

			// Change toggle values
			const newToggles = {
				alwaysAllowReadOnly: false,
				alwaysAllowWrite: false,
			}

			rerender({ toggles: newToggles, autoApprovalEnabled: true })

			expect(result.current.hasEnabledOptions).toBe(false)
			expect(result.current.effectiveAutoApprovalEnabled).toBe(true)
		})

		it("should recompute effectiveAutoApprovalEnabled when autoApprovalEnabled changes", () => {
			const toggles = {
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: false,
			}

			const { result, rerender } = renderHook(
				({ toggles, autoApprovalEnabled }) => useAutoApprovalState(toggles, autoApprovalEnabled),
				{
					initialProps: {
						toggles,
						autoApprovalEnabled: true,
					},
				},
			)

			expect(result.current.effectiveAutoApprovalEnabled).toBe(true)

			rerender({ toggles, autoApprovalEnabled: false })

			expect(result.current.effectiveAutoApprovalEnabled).toBe(false)
		})
	})

	describe("edge cases", () => {
		it("should handle partial toggle objects", () => {
			const toggles = {
				alwaysAllowReadOnly: true,
				// Other properties are optional
			}

			const { result } = renderHook(() => useAutoApprovalState(toggles, true))

			expect(result.current.hasEnabledOptions).toBe(true)
			expect(result.current.effectiveAutoApprovalEnabled).toBe(true)
		})

		it("should handle empty toggle object", () => {
			const toggles = {}

			const { result } = renderHook(() => useAutoApprovalState(toggles, true))

			expect(result.current.hasEnabledOptions).toBe(false)
			expect(result.current.effectiveAutoApprovalEnabled).toBe(true)
		})

		it("should handle mixed truthy/falsy values correctly", () => {
			const toggles = {
				alwaysAllowReadOnly: 1 as any, // truthy non-boolean
				alwaysAllowWrite: "" as any, // falsy non-boolean
				alwaysAllowExecute: null as any, // falsy non-boolean
				alwaysAllowBrowser: "yes" as any, // truthy non-boolean
			}

			const { result } = renderHook(() => useAutoApprovalState(toggles, true))

			expect(result.current.hasEnabledOptions).toBe(true) // Because some values are truthy
		})
	})
})
