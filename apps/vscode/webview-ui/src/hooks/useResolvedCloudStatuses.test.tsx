import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useResolvedCloudStatuses } from "./useResolvedCloudStatuses"

const mocks = vi.hoisted(() => ({ resolveCloudSessionStatuses: vi.fn() }))

vi.mock("@/services/grpc-client", () => ({
	CloudServiceClient: { resolveCloudSessionStatuses: mocks.resolveCloudSessionStatuses },
}))

describe("useResolvedCloudStatuses", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.resolveCloudSessionStatuses.mockResolvedValue({
			statuses: [{ sessionId: "ses-visible", status: "completed" }],
		})
	})

	afterEach(() => vi.useRealTimers())

	it("requests only displayed cloud tasks whose status is unknown", async () => {
		const { result } = renderHook(() =>
			useResolvedCloudStatuses([
				{ id: "ses-visible", executionTarget: "cloud", cloudStatus: "unknown" },
				{ id: "ses-known", executionTarget: "cloud", cloudStatus: "completed" },
				{ id: "local-task", executionTarget: "local", cloudStatus: "unknown" },
			]),
		)

		await waitFor(() => expect(result.current.get("ses-visible")).toBe("completed"))
		expect(mocks.resolveCloudSessionStatuses).toHaveBeenCalledWith(expect.objectContaining({ sessionIds: ["ses-visible"] }))
	})

	it("retries while a displayed cloud status remains indeterminate", async () => {
		vi.useFakeTimers()
		mocks.resolveCloudSessionStatuses.mockResolvedValue({
			statuses: [{ sessionId: "ses-visible", status: "unknown" }],
		})
		renderHook(() => useResolvedCloudStatuses([{ id: "ses-visible", executionTarget: "cloud", cloudStatus: "unknown" }]))
		await act(async () => {})
		expect(mocks.resolveCloudSessionStatuses).toHaveBeenCalledTimes(1)

		await act(() => vi.advanceTimersByTimeAsync(30_000))
		await act(async () => {})
		expect(mocks.resolveCloudSessionStatuses).toHaveBeenCalledTimes(2)
	})
})
