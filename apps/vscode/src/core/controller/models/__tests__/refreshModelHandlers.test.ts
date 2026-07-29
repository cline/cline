import type { ModelInfo } from "@shared/api"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Fingerprint, ProviderCatalog, ProviderModelsResult } from "@/sdk/model-catalog/contracts"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { ProviderCatalogController } from "../providerCatalogShared"
import { refreshBasetenModels } from "../refreshBasetenModels"
import { refreshGroqModels } from "../refreshGroqModels"
import { refreshHicapModels } from "../refreshHicapModels"
import { refreshHuggingFaceModels } from "../refreshHuggingFaceModels"
import { refreshOpenRouterModels } from "../refreshOpenRouterModels"
import { refreshVercelAiGatewayModels } from "../refreshVercelAiGatewayModels"

function makeCatalog(): ProviderCatalog {
	return {
		listProviders: vi.fn(async () => []),
		invalidateProviderListings: vi.fn(),
		resolveModels: vi.fn(),
		peekModels: vi.fn(),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
	}
}

function makeController(catalog: ProviderCatalog): ProviderCatalogController {
	return {
		getProviderConfigStore: () => {
			throw new Error("not used by refresh handlers")
		},
		getProviderCatalog: () => catalog,
	}
}

function okResult(providerId: string, models: Record<string, ModelInfo>): ProviderModelsResult {
	return {
		ok: true,
		providerId: parseProviderId(providerId),
		configFingerprint: "fp" as Fingerprint,
		models: new Map(Object.entries(models)),
		defaultModelId: Object.keys(models)[0] ?? "",
		source: "sdk-dynamic",
		fetchedAt: Date.now(),
	}
}

const sonnetInfo: ModelInfo = {
	name: "Anthropic: Claude Sonnet 4.5",
	contextWindow: 1_000_000,
	maxTokens: 64_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 3,
	outputPrice: 15,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
	description: "Live description",
}

describe("refresh model handlers delegate to the SDK provider catalog", () => {
	afterEach(() => {
		vi.clearAllMocks()
	})

	const recordReturningHandlers = [
		{ name: "refreshOpenRouterModels", handler: refreshOpenRouterModels, providerId: "openrouter" },
		{ name: "refreshGroqModels", handler: refreshGroqModels, providerId: "groq" },
		{ name: "refreshBasetenModels", handler: refreshBasetenModels, providerId: "baseten" },
		{ name: "refreshVercelAiGatewayModels", handler: refreshVercelAiGatewayModels, providerId: "vercel-ai-gateway" },
	] as const

	for (const { name, handler, providerId } of recordReturningHandlers) {
		it(`${name} resolves ${providerId} models through the catalog`, async () => {
			const catalog = makeCatalog()
			vi.mocked(catalog.resolveModels).mockResolvedValue(
				okResult(providerId, { "anthropic/claude-sonnet-4.5": sonnetInfo }),
			)

			const models = await handler(makeController(catalog))

			expect(catalog.resolveModels).toHaveBeenCalledWith(parseProviderId(providerId))
			expect(models["anthropic/claude-sonnet-4.5"]).toEqual(sonnetInfo)
		})
	}

	it("refreshHuggingFaceModels returns protobuf-shaped models from the catalog", async () => {
		const catalog = makeCatalog()
		vi.mocked(catalog.resolveModels).mockResolvedValue(okResult("huggingface", { "meta-llama/llama": sonnetInfo }))

		const response = await refreshHuggingFaceModels(makeController(catalog), {})

		expect(catalog.resolveModels).toHaveBeenCalledWith(parseProviderId("huggingface"))
		expect(response.models["meta-llama/llama"]).toMatchObject({
			contextWindow: 1_000_000,
			maxTokens: 64_000,
			inputPrice: 3,
			outputPrice: 15,
		})
	})

	it("refreshHicapModels returns protobuf-shaped models from the catalog", async () => {
		const catalog = makeCatalog()
		vi.mocked(catalog.resolveModels).mockResolvedValue(okResult("hicap", { "hicap-pro": sonnetInfo }))

		const response = await refreshHicapModels(makeController(catalog), {})

		expect(catalog.resolveModels).toHaveBeenCalledWith(parseProviderId("hicap"))
		expect(response.models["hicap-pro"]).toMatchObject({ contextWindow: 1_000_000 })
	})

	it("throws when the catalog reports an error", async () => {
		const catalog = makeCatalog()
		vi.mocked(catalog.resolveModels).mockResolvedValue({
			ok: false,
			providerId: parseProviderId("openrouter"),
			configFingerprint: "fp" as Fingerprint,
			error: { kind: "unknown", message: "catalog exploded" },
			fetchedAt: Date.now(),
		})

		await expect(refreshOpenRouterModels(makeController(catalog))).rejects.toThrow("catalog exploded")
	})
})
