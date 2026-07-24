import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { refreshOpenAiModels } from "../refreshOpenAiModels"

const mocks = vi.hoisted(() => ({
	axiosGet: vi.fn(),
	readProviderConfig: vi.fn(),
}))

vi.mock("axios", () => ({
	default: {
		get: mocks.axiosGet,
		isAxiosError: vi.fn(() => false),
	},
}))

vi.mock("@/shared/net", () => ({
	getAxiosSettings: () => ({}),
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
	} as unknown as Parameters<typeof refreshOpenAiModels>[0]
}

describe("refreshOpenAiModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.axiosGet.mockResolvedValue({
			data: {
				data: [{ id: "model-alpha" }, { id: "model-beta" }, { id: "model-alpha" }],
			},
		})
	})

	it("fetches and dedupes the model list using the stored provider config", async () => {
		mocks.readProviderConfig.mockReturnValue({
			baseUrl: "http://localhost:1234/v1",
			apiKey: "secret-key",
			headers: { "x-custom": "yes" },
		})

		const response = await refreshOpenAiModels(makeController(), OpenAiModelsRequest.create({ providerId: "openai" }))

		expect(response.values).toEqual(["model-alpha", "model-beta"])
		expect(mocks.axiosGet).toHaveBeenCalledWith(
			"http://localhost:1234/v1/models",
			expect.objectContaining({
				headers: {
					"x-custom": "yes",
					Authorization: "Bearer secret-key",
				},
			}),
		)
	})

	it("strips trailing slashes from the base URL before appending /models", async () => {
		mocks.readProviderConfig.mockReturnValue({ baseUrl: "http://localhost:1234/v1/" })

		await refreshOpenAiModels(makeController(), OpenAiModelsRequest.create({ providerId: "openai" }))

		expect(mocks.axiosGet).toHaveBeenCalledWith("http://localhost:1234/v1/models", expect.anything())
	})

	it("returns an empty list when no base URL is configured", async () => {
		mocks.readProviderConfig.mockReturnValue({})

		const response = await refreshOpenAiModels(makeController(), OpenAiModelsRequest.create({ providerId: "openai" }))

		expect(response.values).toEqual([])
		expect(mocks.axiosGet).not.toHaveBeenCalled()
	})

	it("returns an empty list when the request fails", async () => {
		mocks.readProviderConfig.mockReturnValue({ baseUrl: "http://localhost:1234/v1" })
		mocks.axiosGet.mockRejectedValue(new Error("boom"))

		const response = await refreshOpenAiModels(makeController(), OpenAiModelsRequest.create({ providerId: "openai" }))

		expect(response.values).toEqual([])
	})
})
