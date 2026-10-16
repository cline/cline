import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useProviderApiKeyField } from "./useProviderApiKeyField"

describe("useProviderApiKeyField", () => {
	afterEach(() => vi.restoreAllMocks())

	it("notifies after a same-length API key replacement is saved", async () => {
		const write = vi.fn(async () => undefined)
		const onApiKeyWriteSuccess = vi.fn()
		const { result } = renderHook(() =>
			useProviderApiKeyField({
				apiKeyLength: 8,
				onApiKeyWriteSuccess,
				providerName: "LM Studio",
				write,
			}),
		)

		act(() => result.current.handleApiKeyChange("new-key8"))

		await waitFor(() => expect(onApiKeyWriteSuccess).toHaveBeenCalledTimes(1))
		expect(write).toHaveBeenCalledWith({ apiKey: "new-key8" })
	})

	it("does not notify when the API key write fails", async () => {
		const write = vi.fn(async () => Promise.reject(new Error("write failed")))
		const onApiKeyWriteSuccess = vi.fn()
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
		const { result } = renderHook(() =>
			useProviderApiKeyField({
				apiKeyLength: 8,
				onApiKeyWriteSuccess,
				providerName: "LM Studio",
				write,
			}),
		)

		act(() => result.current.handleApiKeyChange("new-key8"))

		await waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1))
		expect(onApiKeyWriteSuccess).not.toHaveBeenCalled()
	})
})
