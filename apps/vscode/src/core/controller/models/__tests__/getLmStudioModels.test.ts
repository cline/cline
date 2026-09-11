import { StringRequest } from "@shared/proto/cline/common"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getLmStudioModels } from "../getLmStudioModels"

const mocks = vi.hoisted(() => ({
	fetch: vi.fn(),
	readProviderConfig: vi.fn(),
}))

vi.mock("@/shared/net", () => ({
	fetch: mocks.fetch,
}))

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
	},
}))

function makeController() {
	return {
		getProviderConfigStore: () => ({
			read: mocks.readProviderConfig,
		}),
	} as unknown as Parameters<typeof getLmStudioModels>[0]
}

describe("getLmStudioModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.fetch.mockResolvedValue({
			json: vi.fn().mockResolvedValue({
				data: [{ id: "model-alpha" }, { id: "model-beta" }],
			}),
		})
	})

	it("fetches the model list from the LM Studio server", async () => {
		mocks.readProviderConfig.mockReturnValue({})

		const response = await getLmStudioModels(makeController(), StringRequest.create({ value: "http://localhost:1234" }))

		expect(response.values).toHaveLength(2)
		expect(mocks.fetch).toHaveBeenCalledWith("http://localhost:1234/api/v0/models", { headers: {} })
	})

	it("sends the stored API key as a Bearer token when configured", async () => {
		mocks.readProviderConfig.mockReturnValue({ apiKey: "secret-key" })

		await getLmStudioModels(makeController(), StringRequest.create({ value: "http://localhost:1234" }))

		expect(mocks.fetch).toHaveBeenCalledWith("http://localhost:1234/api/v0/models", {
			headers: { Authorization: "Bearer secret-key" },
		})
	})

	it("returns an empty list when the base URL is invalid", async () => {
		mocks.readProviderConfig.mockReturnValue({})

		const response = await getLmStudioModels(makeController(), StringRequest.create({ value: "not-a-url" }))

		expect(response.values).toEqual([])
		expect(mocks.fetch).not.toHaveBeenCalled()
	})

	it("returns an empty list when the request fails", async () => {
		mocks.readProviderConfig.mockReturnValue({})
		mocks.fetch.mockRejectedValue(new Error("boom"))

		const response = await getLmStudioModels(makeController(), StringRequest.create({ value: "http://localhost:1234" }))

		expect(response.values).toEqual([])
	})
})
