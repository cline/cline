import { beforeEach, describe, expect, it, vi } from "vitest"
import { refreshGroqModels } from "../refreshGroqModels"

const mocks = vi.hoisted(() => ({
	axiosGet: vi.fn(),
	captureProviderApiError: vi.fn(),
	getModelsCache: vi.fn(),
	getProviderCollectionSync: vi.fn(),
	getSecretKey: vi.fn(),
	setModelsCache: vi.fn(),
	writeFile: vi.fn(),
}))

vi.mock("@cline/llms", () => ({
	getProviderCollectionSync: mocks.getProviderCollectionSync,
}))

vi.mock("@core/storage/disk", () => ({
	GlobalFileNames: {
		groqModels: "groq_models.json",
	},
	ensureCacheDirectoryExists: vi.fn(async () => "/tmp/cline-cache"),
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getModelsCache: mocks.getModelsCache,
			setModelsCache: mocks.setModelsCache,
		}),
	},
}))

vi.mock("@/services/telemetry", () => ({
	telemetryService: {
		captureProviderApiError: mocks.captureProviderApiError,
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

vi.mock("@utils/fs", () => ({
	fileExistsAtPath: vi.fn(async () => false),
}))

vi.mock("axios", () => ({
	default: {
		get: mocks.axiosGet,
		isAxiosError: vi.fn(() => false),
	},
}))

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn(),
		writeFile: mocks.writeFile,
	},
}))

describe("refreshGroqModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.getModelsCache.mockReturnValue(null)
		mocks.getProviderCollectionSync.mockReturnValue({ models: {} })
		mocks.getSecretKey.mockReturnValue("gsk_test_key")
		mocks.axiosGet.mockResolvedValue({
			data: {
				data: [
					{
						id: "groq-new-chat-model",
						object: "model",
						active: true,
						max_completion_tokens: 4096,
						context_window: 8192,
						owned_by: "Groq",
					},
				],
			},
		})
	})

	it("defaults cache pricing for live models missing SDK catalog metadata", async () => {
		const controller = {
			stateManager: {
				getSecretKey: mocks.getSecretKey,
			},
			task: {
				ulid: "task-1",
			},
		} as unknown as Parameters<typeof refreshGroqModels>[0]

		const models = await refreshGroqModels(controller)

		expect(models["groq-new-chat-model"]).toMatchObject({
			maxTokens: 4096,
			contextWindow: 8192,
			cacheWritesPrice: 0,
			cacheReadsPrice: 0,
			description: "Groq model with 8,192 token context window",
		})
		expect(mocks.captureProviderApiError).not.toHaveBeenCalled()
		expect(mocks.setModelsCache).toHaveBeenCalledWith("groq", expect.objectContaining(models))
	})
})
