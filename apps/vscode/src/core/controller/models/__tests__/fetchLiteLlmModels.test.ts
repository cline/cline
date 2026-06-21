import { afterEach, describe, expect, it, vi } from "vitest"
import { mockFetchForTesting } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { fetchLiteLlmModelsInfo } from "../fetchLiteLlmModels"

describe("fetchLiteLlmModelsInfo", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("falls back to /model/info when /v1/model/info is unavailable", async () => {
		const payload = {
			data: [
				{
					model_name: "claude",
					litellm_params: { model: "anthropic/claude" },
					model_info: {},
				},
			],
		}
		const mockFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("no v1 route", { status: 404 }))
			.mockResolvedValueOnce(new Response("no v1 route", { status: 404 }))
			.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))

		const result = await mockFetchForTesting(mockFetch, () => fetchLiteLlmModelsInfo("http://localhost:4000/v1/", "key"))

		expect(result).toEqual(payload)
		expect(mockFetch.mock.calls.map((call) => call[0])).toEqual([
			"http://localhost:4000/v1/model/info",
			"http://localhost:4000/v1/model/info",
			"http://localhost:4000/model/info",
		])
	})

	it("includes attempted path, auth header, status, and response body when all attempts fail", async () => {
		const loggerError = vi.spyOn(Logger, "error").mockImplementation(() => undefined)
		const mockFetch = vi
			.fn<typeof fetch>()
			.mockImplementation(() => Promise.resolve(new Response('{"error":"unauthorized"}', { status: 401 })))

		await expect(
			mockFetchForTesting(mockFetch, () => fetchLiteLlmModelsInfo("http://localhost:4000", "key")),
		).rejects.toThrow('/v1/model/info (x-litellm-api-key): 401: {"error":"unauthorized"}')

		expect(loggerError).toHaveBeenCalledWith(
			expect.stringContaining('/model/info (Authorization): 401: {"error":"unauthorized"}'),
		)
	})
})
