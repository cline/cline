import type { ModelInfo } from "@shared/api"
import { describe, expect, it, vi } from "vitest"
import type { ProviderCatalog } from "@/sdk/model-catalog/contracts"
import type { ProviderCatalogController } from "../providerCatalogShared"
import { refreshBasetenModels } from "../refreshBasetenModels"
import { refreshGroqModels } from "../refreshGroqModels"
import { refreshOpenRouterModels } from "../refreshOpenRouterModels"
import { refreshVercelAiGatewayModels } from "../refreshVercelAiGatewayModels"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

const MODEL: ModelInfo = {
	name: "Rich Model",
	contextWindow: 200_000,
	maxTokens: 8192,
	supportsPromptCache: true,
	inputPrice: 3,
	outputPrice: 15,
}

function makeController(result: unknown): { controller: ProviderCatalogController; resolveModels: ReturnType<typeof vi.fn> } {
	const resolveModels = vi.fn(async () => result)
	const catalog = { resolveModels } as unknown as ProviderCatalog
	const controller = {
		getProviderCatalog: () => catalog,
		getProviderConfigStore: () => {
			throw new Error("not used")
		},
	} as unknown as ProviderCatalogController
	return { controller, resolveModels }
}

function okResult(providerId: string) {
	return {
		ok: true as const,
		providerId,
		configFingerprint: "fp",
		models: new Map([["vendor/rich-model", MODEL]]),
		defaultModelId: "vendor/rich-model",
		source: "sdk-dynamic",
		fetchedAt: 0,
	}
}

describe("provider model refresh handlers (SDK catalog delegation)", () => {
	it.each([
		["openrouter", refreshOpenRouterModels],
		["groq", refreshGroqModels],
		["baseten", refreshBasetenModels],
		["vercel-ai-gateway", refreshVercelAiGatewayModels],
	] as const)("resolves %s models through the SDK provider catalog", async (providerId, refresh) => {
		const { controller, resolveModels } = makeController(okResult(providerId))

		const models = await refresh(controller)

		expect(resolveModels).toHaveBeenCalledWith(providerId, undefined)
		expect(models).toEqual({ "vendor/rich-model": MODEL })
	})

	it("throws the catalog error when model resolution fails", async () => {
		const { controller } = makeController({
			ok: false as const,
			providerId: "openrouter",
			configFingerprint: "fp",
			error: { kind: "unknown", message: "catalog exploded" },
			fetchedAt: 0,
		})

		await expect(refreshOpenRouterModels(controller)).rejects.toThrow("catalog exploded")
	})
})
