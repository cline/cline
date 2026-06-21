import type { ApiConfiguration } from "@shared/api"
import { ApiFormat, OpenRouterModelInfo } from "@shared/proto/cline/models"
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
	EffectiveProviderConfig,
	ProviderCatalog,
	ProviderConfigStore,
	ProviderListing,
} from "@/sdk/model-catalog/contracts"
import { computeConfigFingerprint } from "@/sdk/model-catalog/fingerprint"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { ProviderCatalogController } from "../providerCatalogShared"

type TestStateManager = {
	setGlobalStateBatch?: ReturnType<typeof vi.fn>
	getApiConfiguration?: ReturnType<typeof vi.fn<() => ApiConfiguration | undefined>>
	getRemoteConfigSettings?: ReturnType<typeof vi.fn<() => Record<string, unknown>>>
}

function makeStore(config: EffectiveProviderConfig): ProviderConfigStore {
	return {
		read: vi.fn(() => config),
		readSelection: vi.fn(() => undefined),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
		write: vi.fn(() => config),
		commitSelection: vi.fn(),
	}
}

function makeCatalog(providers: ProviderListing[] = []): ProviderCatalog {
	return {
		listProviders: vi.fn(async () => providers),
		resolveModels: vi.fn(),
		peekModels: vi.fn(),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
	}
}

function makeProviderListing(id: string, paths: string[]): ProviderListing {
	return {
		id: parseProviderId(id),
		name: id,
		defaultModelId: "test-model",
		configFields: paths.map((path) => ({
			path,
			label: path,
			type: path === "apiKey" || path.endsWith("secretKey") ? "password" : "text",
		})),
		allowsCustomModelIds: false,
		usageCostDisplay: "show",
	}
}

function makeController(
	store: ProviderConfigStore,
	catalog: ProviderCatalog,
	stateManager?: TestStateManager,
	handleApiConfigurationChanged?: ReturnType<typeof vi.fn<(previous: ApiConfiguration, next: ApiConfiguration) => void>>,
): ProviderCatalogController {
	return {
		getProviderConfigStore: () => store,
		getProviderCatalog: () => catalog,
		...(stateManager ? { stateManager } : {}),
		...(handleApiConfigurationChanged ? { handleApiConfigurationChanged } : {}),
	}
}

describe("provider model catalog handlers", () => {
	afterEach(() => {
		vi.clearAllMocks()
	})

	it("listProviders returns provider listings from the catalog singleton", async () => {
		const { listProviders } = await import("../listProviders")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		const catalog = makeCatalog()
		vi.mocked(catalog.listProviders).mockResolvedValue([
			{
				id: providerId,
				name: "DeepSeek",
				defaultModelId: "deepseek-v4-flash",
				protocol: "openai-chat",
				authDescription: "DeepSeek models",
				configFields: [
					{
						path: "apiKey",
						label: "API Key",
						type: "password",
						secret: true,
					},
					{
						path: "aws.authentication",
						label: "Authentication",
						type: "select",
						options: [
							{ label: "AWS SDK / IAM", value: "iam" },
							{ label: "API Key", value: "api-key" },
						],
						defaultValue: "iam",
					},
					{
						path: "aws.useGlobalInference",
						label: "Global Inference",
						type: "boolean",
						defaultValue: false,
					},
				],
				configValues: {
					apiKey: "SECRET_SENTINEL_LISTING_API_KEY",
					baseUrl: "https://api.deepseek.com/v1",
					headers: {
						authorization: "Bearer SECRET_SENTINEL_HEADER",
						"x-safe-header": "visible",
					},
					"aws.authentication": "api-key",
					"aws.useGlobalInference": true,
				},
				allowsCustomModelIds: false,
				usageCostDisplay: "show",
			},
		])
		const controller = makeController(store, catalog)

		const response = await listProviders(controller, {})

		expect(response.providers).toEqual([
			{
				id: "deepseek",
				name: "DeepSeek",
				defaultModelId: "deepseek-v4-flash",
				family: undefined,
				protocol: "openai-chat",
				authDescription: "DeepSeek models",
				baseUrlDescription: undefined,
				configFields: [
					{
						path: "apiKey",
						label: "API Key",
						type: "password",
						placeholder: undefined,
						description: undefined,
						secret: true,
						required: false,
						options: [],
						defaultValueJson: undefined,
					},
					{
						path: "aws.authentication",
						label: "Authentication",
						type: "select",
						placeholder: undefined,
						description: undefined,
						secret: false,
						required: false,
						options: [
							{ label: "AWS SDK / IAM", value: "iam", valueJson: '"iam"' },
							{ label: "API Key", value: "api-key", valueJson: '"api-key"' },
						],
						defaultValueJson: '"iam"',
					},
					{
						path: "aws.useGlobalInference",
						label: "Global Inference",
						type: "boolean",
						placeholder: undefined,
						description: undefined,
						secret: false,
						required: false,
						options: [],
						defaultValueJson: "false",
					},
				],
				configValuesJson: {
					baseUrl: '"https://api.deepseek.com/v1"',
					headers: '{"authorization":"","x-safe-header":"visible"}',
					"aws.authentication": '"api-key"',
					"aws.useGlobalInference": "true",
				},
				allowsCustomModelIds: false,
				usageCostDisplay: "show",
			},
		])
		expect(JSON.stringify(response)).not.toContain("SECRET_SENTINEL")
		expect(catalog.listProviders).toHaveBeenCalledTimes(1)
	})

	it("readProviderConfig redacts sensitive custom header values", async () => {
		const { readProviderConfig } = await import("../readProviderConfig")
		const providerId = parseProviderId("openai-compatible")
		const store = makeStore({
			providerId,
			headers: {
				authorization: "Bearer SECRET_SENTINEL_AUTH_HEADER",
				cookie: "SECRET_SENTINEL_COOKIE",
				"x-safe-header": "visible",
			},
		})
		const controller = makeController(store, makeCatalog())

		const response = await readProviderConfig(controller, { value: "openai-compatible" })

		expect(response.headers).toEqual({
			authorization: "",
			cookie: "",
			"x-safe-header": "visible",
		})
		expect(JSON.stringify(response)).not.toContain("SECRET_SENTINEL")
	})

	it("resolveProviderModels returns full protobuf model metadata and request id", async () => {
		const { resolveProviderModels } = await import("../resolveProviderModels")
		const providerId = parseProviderId("deepseek")
		const fingerprint = computeConfigFingerprint(providerId, { providerId, apiKey: "secret" })
		const store = makeStore({ providerId, apiKey: "secret" })
		const catalog = makeCatalog()
		vi.mocked(catalog.resolveModels).mockResolvedValue({
			ok: true,
			providerId,
			configFingerprint: fingerprint,
			models: new Map([
				[
					"deepseek-v4-flash",
					{
						name: "DeepSeek V4 Flash",
						maxTokens: 123,
						contextWindow: 456,
						supportsImages: true,
						supportsPromptCache: true,
						supportsReasoning: true,
						inputPrice: 1,
						outputPrice: 2,
						cacheWritesPrice: 3,
						cacheReadsPrice: 4,
						description: "rich metadata",
						temperature: 0.2,
						apiFormat: ApiFormat.OPENAI_CHAT,
					},
				],
			]),
			defaultModelId: "deepseek-v4-flash",
			source: "sdk-dynamic",
			fetchedAt: 99,
		})
		const controller = makeController(store, catalog)

		const response = await resolveProviderModels(controller, {
			providerId: "deepseek",
			forceRefresh: true,
			requestId: "req-1",
		})

		expect(response.requestId).toBe("req-1")
		expect(response.configFingerprint).toBe(fingerprint)
		expect(response.models["deepseek-v4-flash"]).toMatchObject({
			name: "DeepSeek V4 Flash",
			maxTokens: 123,
			contextWindow: 456,
			supportsImages: true,
			supportsPromptCache: true,
			supportsReasoning: true,
			temperature: 0.2,
			apiFormat: ApiFormat.OPENAI_CHAT,
		})
		expect(catalog.resolveModels).toHaveBeenCalledWith(providerId, { forceRefresh: true })
	})

	it("readProviderConfig redacts secrets", async () => {
		const { readProviderConfig } = await import("../readProviderConfig")
		const providerId = parseProviderId("cline")
		const store = makeStore({
			providerId,
			apiKey: "SECRET_SENTINEL_API_KEY",
			baseUrl: "https://api.example.com/v1",
			auth: { accessToken: "SECRET_SENTINEL_ACCESS", refreshToken: "SECRET_SENTINEL_REFRESH", accountId: "acct-1" },
		})
		const controller = makeController(store, makeCatalog())

		const response = await readProviderConfig(controller, { value: "cline" })

		expect(response).toMatchObject({
			providerId: "cline",
			baseUrl: "https://api.example.com/v1",
			apiKeyLength: "SECRET_SENTINEL_API_KEY".length,
			hasAccessToken: true,
			hasRefreshToken: true,
			accountId: "acct-1",
		})
		expect(JSON.stringify(response)).not.toContain("SECRET_SENTINEL")
	})

	it("writeProviderConfig writes a patch and returns redacted updated config", async () => {
		const { writeProviderConfig } = await import("../writeProviderConfig")
		const providerId = parseProviderId("ollama")
		const updatedConfig: EffectiveProviderConfig = {
			providerId,
			apiKey: "SECRET_SENTINEL_OLLAMA",
			baseUrl: "http://localhost:11434/v1",
		}
		const store = makeStore(updatedConfig)
		const controller = makeController(
			store,
			makeCatalog([
				makeProviderListing("bedrock", ["apiKey", "aws.authentication", "aws.region", "aws.customModelBaseId"]),
			]),
		)

		const response = await writeProviderConfig(controller, {
			providerId: "ollama",
			patch: { apiKey: "SECRET_SENTINEL_OLLAMA", baseUrl: "http://localhost:11434/v1", headers: {} },
		})

		expect(store.write).toHaveBeenCalledWith(providerId, {
			apiKey: "SECRET_SENTINEL_OLLAMA",
			baseUrl: "http://localhost:11434/v1",
		})
		expect(response.apiKeyLength).toBe("SECRET_SENTINEL_OLLAMA".length)
		expect(JSON.stringify(response)).not.toContain("SECRET_SENTINEL")
	})

	it("writeProviderConfig routes settings_json through the provider config store", async () => {
		const { writeProviderConfig } = await import("../writeProviderConfig")
		const providerId = parseProviderId("bedrock")
		const updatedConfig: EffectiveProviderConfig = {
			providerId,
			apiKey: "SECRET_SENTINEL_BEDROCK",
			aws: {
				authentication: "api-key",
				region: "us-east-2",
				customModelBaseId: "base-profile",
			},
		}
		const store = makeStore(updatedConfig)
		const controller = makeController(
			store,
			makeCatalog([
				makeProviderListing("bedrock", ["apiKey", "aws.authentication", "aws.region", "aws.customModelBaseId"]),
			]),
		)

		const response = await writeProviderConfig(controller, {
			providerId: "bedrock",
			patch: {
				headers: {},
				settingsJson: JSON.stringify({
					apiKey: "SECRET_SENTINEL_BEDROCK",
					aws: {
						authentication: "api-key",
						region: "us-east-2",
						customModelBaseId: "base-profile",
					},
					auth: {
						accessToken: "SECRET_SENTINEL_UNADVERTISED_TOKEN",
					},
					extras: {
						unadvertised: true,
					},
				}),
			},
		})

		expect(store.write).toHaveBeenCalledWith(providerId, {
			settings: {
				apiKey: "SECRET_SENTINEL_BEDROCK",
				aws: {
					authentication: "api-key",
					region: "us-east-2",
					customModelBaseId: "base-profile",
				},
			},
			apiKey: "SECRET_SENTINEL_BEDROCK",
			aws: {
				authentication: "api-key",
				region: "us-east-2",
				customModelBaseId: "base-profile",
			},
		})
		expect(response.apiKeyLength).toBe("SECRET_SENTINEL_BEDROCK".length)
		expect(JSON.stringify(response)).not.toContain("SECRET_SENTINEL")
		expect(JSON.stringify(vi.mocked(store.write).mock.calls)).not.toContain("UNADVERTISED")
	})

	it("writeProviderConfig ignores settings_json writes for remotely locked provider fields", async () => {
		const { writeProviderConfig } = await import("../writeProviderConfig")
		const providerId = parseProviderId("openai-compatible")
		const updatedConfig: EffectiveProviderConfig = {
			providerId,
			apiKey: "SECRET_SENTINEL_OPENAI",
			baseUrl: "https://remote.example/v1",
		}
		const store = makeStore(updatedConfig)
		const controller = makeController(
			store,
			makeCatalog([makeProviderListing("openai-compatible", ["apiKey", "baseUrl", "headers", "azure.apiVersion"])]),
			{
				getRemoteConfigSettings: vi.fn(() => ({
					remoteConfiguredProviders: ["openai-compatible"],
					openAiBaseUrl: "https://remote.example/v1",
					openAiHeaders: { "x-remote": "locked" },
					azureApiVersion: "2026-01-01-preview",
				})),
			},
		)

		await writeProviderConfig(controller, {
			providerId: "openai-compatible",
			patch: {
				headers: {},
				settingsJson: JSON.stringify({
					apiKey: "SECRET_SENTINEL_OPENAI",
					baseUrl: "https://local.example/v1",
					headers: { "x-local": "blocked" },
					azure: { apiVersion: "2024-02-15-preview" },
				}),
			},
		})

		expect(store.write).toHaveBeenCalledWith(providerId, {
			settings: {
				apiKey: "SECRET_SENTINEL_OPENAI",
			},
			apiKey: "SECRET_SENTINEL_OPENAI",
		})
	})

	it("writeProviderConfig rejects non-object settings_json payloads", async () => {
		const { writeProviderConfig } = await import("../writeProviderConfig")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		const controller = makeController(store, makeCatalog())

		await expect(
			writeProviderConfig(controller, {
				providerId: "deepseek",
				patch: { headers: {}, settingsJson: JSON.stringify(["not", "an", "object"]) },
			}),
		).rejects.toThrow("settings_json must be a JSON object")
		expect(store.write).not.toHaveBeenCalled()
	})

	it("writeProviderConfig can explicitly clear headers", async () => {
		const { writeProviderConfig } = await import("../writeProviderConfig")
		const providerId = parseProviderId("openai")
		const updatedConfig: EffectiveProviderConfig = {
			providerId,
			headers: {},
		}
		const store = makeStore(updatedConfig)
		const controller = makeController(store, makeCatalog([makeProviderListing("openai", ["headers"])]))

		await writeProviderConfig(controller, {
			providerId: "openai",
			patch: { headers: {}, clearHeaders: true },
		})

		expect(store.write).toHaveBeenCalledWith(providerId, { headers: {} })
	})

	it("writeProviderConfig ignores direct webview auth and unadvertised header writes", async () => {
		const { writeProviderConfig } = await import("../writeProviderConfig")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		const controller = makeController(store, makeCatalog([makeProviderListing("deepseek", ["apiKey"])]))

		await writeProviderConfig(controller, {
			providerId: "deepseek",
			patch: {
				apiKey: "SECRET_SENTINEL_API_KEY",
				headers: { authorization: "Bearer SECRET_SENTINEL_HEADER" },
				accessToken: "SECRET_SENTINEL_ACCESS",
			},
		})

		expect(store.write).toHaveBeenCalledWith(providerId, {
			apiKey: "SECRET_SENTINEL_API_KEY",
		})
	})

	it("commitModelSelection validates mode and commits the full selection envelope", async () => {
		const { commitModelSelection } = await import("../commitModelSelection")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		const stateManager: TestStateManager = { setGlobalStateBatch: vi.fn() }
		const controller = makeController(store, makeCatalog(), stateManager)

		await commitModelSelection(controller, {
			providerId: "deepseek",
			mode: "act",
			modelId: "deepseek-v4-flash",
			modelInfo: OpenRouterModelInfo.create({
				name: "DeepSeek V4 Flash",
				contextWindow: 456,
				supportsPromptCache: true,
				apiFormat: ApiFormat.OPENAI_CHAT,
			}),
		})

		expect(store.commitSelection).toHaveBeenCalledWith(providerId, "act", {
			providerId,
			modelId: "deepseek-v4-flash",
			modelInfo: expect.objectContaining({
				name: "DeepSeek V4 Flash",
				contextWindow: 456,
				supportsPromptCache: true,
				apiFormat: ApiFormat.OPENAI_CHAT,
			}),
		})
		expect(stateManager.setGlobalStateBatch).toHaveBeenCalledWith({
			planModeApiProvider: "deepseek",
			planModeApiModelId: "deepseek-v4-flash",
			actModeApiProvider: "deepseek",
			actModeApiModelId: "deepseek-v4-flash",
		})
	})

	it("commitModelSelection persists SAP deployment metadata from SDK-owned model discovery", async () => {
		const { commitModelSelection } = await import("../commitModelSelection")
		const providerId = parseProviderId("sapaicore")
		const store = makeStore({ providerId })
		const catalog = makeCatalog()
		const modelInfo = {
			name: "Claude Sonnet deployment",
			contextWindow: 128_000,
			supportsPromptCache: true,
			metadata: {
				sap: {
					deploymentId: "deployment-123",
				},
			},
		}
		vi.mocked(catalog.resolveModels).mockResolvedValue({
			ok: true,
			providerId,
			configFingerprint: computeConfigFingerprint(providerId, { providerId }),
			models: new Map([["anthropic--claude-3.5-sonnet", modelInfo]]),
			defaultModelId: "anthropic--claude-3.5-sonnet",
			source: "sdk-dynamic",
			fetchedAt: 1,
		})
		const stateManager: TestStateManager = { setGlobalStateBatch: vi.fn() }
		const controller = makeController(store, catalog, stateManager)

		await commitModelSelection(controller, {
			providerId: "sapaicore",
			mode: "plan",
			modelId: "anthropic--claude-3.5-sonnet",
			modelInfo: OpenRouterModelInfo.create({
				name: "Claude Sonnet deployment",
				contextWindow: 128_000,
				supportsPromptCache: true,
			}),
		})

		expect(store.write).toHaveBeenCalledWith(providerId, {
			mode: "plan",
			sap: { deploymentId: "deployment-123" },
		})
		expect(store.commitSelection).toHaveBeenCalledWith(providerId, "plan", {
			providerId,
			modelId: "anthropic--claude-3.5-sonnet",
			modelInfo,
		})
	})

	it("commitModelSelection clamps stale selections to remote model allowlists before committing", async () => {
		const { commitModelSelection } = await import("../commitModelSelection")
		const providerId = parseProviderId("openai-compatible")
		const store = makeStore({ providerId })
		const catalog = makeCatalog()
		const allowedModelInfo = {
			name: "Allowed Model",
			contextWindow: 128_000,
			supportsPromptCache: true,
		}
		vi.mocked(catalog.resolveModels).mockResolvedValue({
			ok: true,
			providerId,
			configFingerprint: computeConfigFingerprint(providerId, { providerId }),
			models: new Map([["allowed-model", allowedModelInfo]]),
			defaultModelId: "allowed-model",
			source: "host-adapter",
			fetchedAt: 1,
		})
		const stateManager: TestStateManager = {
			setGlobalStateBatch: vi.fn(),
			getRemoteConfigSettings: vi.fn(() => ({
				remoteProviderModelSettings: {
					"openai-compatible": {
						models: [{ id: "allowed-model" }],
					},
				},
			})),
		}
		const controller = makeController(store, catalog, stateManager)

		await commitModelSelection(controller, {
			providerId: "openai-compatible",
			mode: "act",
			modelId: "blocked-model",
			modelInfo: OpenRouterModelInfo.create({
				name: "Blocked Model",
				contextWindow: 1_000,
				apiFormat: ApiFormat.OPENAI_CHAT,
			}),
		})

		expect(store.commitSelection).toHaveBeenCalledWith(providerId, "act", {
			providerId,
			modelId: "allowed-model",
			modelInfo: allowedModelInfo,
		})
		expect(stateManager.setGlobalStateBatch).toHaveBeenCalledWith({
			planModeApiProvider: "openai",
			planModeOpenAiModelId: "allowed-model",
			actModeApiProvider: "openai",
			actModeOpenAiModelId: "allowed-model",
		})
	})

	it("commitModelSelection reports provider changes when config is initialized", async () => {
		const { commitModelSelection } = await import("../commitModelSelection")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		const stateManager: TestStateManager = {
			setGlobalStateBatch: vi.fn(),
			getApiConfiguration: vi
				.fn<() => ApiConfiguration | undefined>()
				.mockReturnValueOnce(undefined)
				.mockReturnValueOnce({ actModeApiProvider: "deepseek" }),
		}
		const handleApiConfigurationChanged = vi.fn<(previous: ApiConfiguration, next: ApiConfiguration) => void>()
		const controller = makeController(store, makeCatalog(), stateManager, handleApiConfigurationChanged)

		await commitModelSelection(controller, {
			providerId: "deepseek",
			mode: "act",
			modelId: "deepseek-v4-flash",
			modelInfo: OpenRouterModelInfo.create({
				name: "DeepSeek V4 Flash",
				apiFormat: ApiFormat.OPENAI_CHAT,
			}),
		})

		expect(handleApiConfigurationChanged).toHaveBeenCalledWith({}, { actModeApiProvider: "deepseek" })
	})

	it("commitModelSelection rejects invalid mode", async () => {
		const { commitModelSelection } = await import("../commitModelSelection")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		const controller = makeController(store, makeCatalog())

		await expect(
			commitModelSelection(controller, {
				providerId: "deepseek",
				mode: "invalid",
				modelId: "deepseek-v4-flash",
				modelInfo: OpenRouterModelInfo.create({ supportsPromptCache: true }),
			}),
		).rejects.toThrow('mode must be "plan" or "act"')
		expect(store.commitSelection).not.toHaveBeenCalled()
	})
})
