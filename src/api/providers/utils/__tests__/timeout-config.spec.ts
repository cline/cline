// npx vitest run api/providers/utils/__tests__/timeout-config.spec.ts

import { getApiRequestTimeout } from "../timeout-config"
import * as vscode from "vscode"

// Mock vscode
vitest.mock("vscode", () => ({
	workspace: {
		getConfiguration: vitest.fn().mockReturnValue({
			get: vitest.fn(),
		}),
	},
}))

describe("getApiRequestTimeout", () => {
	let mockGetConfig: any

	beforeEach(() => {
		vitest.clearAllMocks()
		mockGetConfig = vitest.fn()
		;(vscode.workspace.getConfiguration as any).mockReturnValue({
			get: mockGetConfig,
		})
	})

	it("should return default timeout of 600000ms when no configuration is set", () => {
		mockGetConfig.mockReturnValue(600)

		const timeout = getApiRequestTimeout()

		expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("roo-cline")
		expect(mockGetConfig).toHaveBeenCalledWith("apiRequestTimeout", 600)
		expect(timeout).toBe(600000) // 600 seconds in milliseconds
	})

	it("should return custom timeout in milliseconds", () => {
		mockGetConfig.mockReturnValue(1200) // 20 minutes

		const timeout = getApiRequestTimeout()

		expect(timeout).toBe(1200000) // 1200 seconds in milliseconds
	})

	it("should handle zero timeout (no timeout)", () => {
		mockGetConfig.mockReturnValue(0)

		const timeout = getApiRequestTimeout()

		expect(timeout).toBe(0) // No timeout
	})

	it("should handle negative values by clamping to 0", () => {
		mockGetConfig.mockReturnValue(-100)

		const timeout = getApiRequestTimeout()

		expect(timeout).toBe(0) // Negative values should be clamped to 0
	})

	it("should handle null by using default", () => {
		mockGetConfig.mockReturnValue(null)

		const timeout = getApiRequestTimeout()

		expect(timeout).toBe(600000) // Should fall back to default 600 seconds
	})

	it("should handle undefined by using default", () => {
		mockGetConfig.mockReturnValue(undefined)

		const timeout = getApiRequestTimeout()

		expect(timeout).toBe(600000) // Should fall back to default 600 seconds
	})

	it("should handle NaN by using default", () => {
		mockGetConfig.mockReturnValue(NaN)

		const timeout = getApiRequestTimeout()

		expect(timeout).toBe(600000) // Should fall back to default 600 seconds
	})

	it("should handle string values by using default", () => {
		mockGetConfig.mockReturnValue("not-a-number") // String instead of number

		const timeout = getApiRequestTimeout()

		expect(timeout).toBe(600000) // Should fall back to default since it's not a number
	})

	it("should handle boolean values by using default", () => {
		mockGetConfig.mockReturnValue(true) // Boolean instead of number

		const timeout = getApiRequestTimeout()

		expect(timeout).toBe(600000) // Should fall back to default since it's not a number
	})
})
