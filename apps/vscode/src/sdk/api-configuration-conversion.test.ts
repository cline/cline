import { ApiFormat, ModelsApiConfiguration, ApiProvider as ProtoApiProvider } from "@shared/proto/cline/models"
import { describe, expect, it } from "vitest"
import {
	convertApiConfigurationToProto,
	convertProtoToApiConfiguration,
} from "@/shared/proto-conversions/models/api-configuration-conversion"

describe("api configuration proto conversion", () => {
	it("round-trips SDK-only provider ids through string provider fields", () => {
		const proto = convertApiConfigurationToProto({
			actModeApiProvider: "poolside" as any,
			planModeApiProvider: "openai",
		})

		expect(proto.actModeApiProvider).toBeUndefined()
		expect(proto.actModeApiProviderId).toBe("poolside")
		expect(proto.planModeApiProvider).toBe(ProtoApiProvider.OPENAI)
		expect(proto.planModeApiProviderId).toBe("openai")

		const config = convertProtoToApiConfiguration(proto)

		expect(config.actModeApiProvider).toBe("poolside")
		expect(config.planModeApiProvider).toBe("openai")
	})

	it("prefers explicit enum provider updates over stale string provider ids", () => {
		const config = convertProtoToApiConfiguration(
			ModelsApiConfiguration.create({
				actModeApiProvider: ProtoApiProvider.OPENAI,
				actModeApiProviderId: "poolside",
			}),
		)

		expect(config.actModeApiProvider).toBe("openai")
	})

	it("round-trips OCA model metadata without dropping thinking or temperature", () => {
		const proto = convertApiConfigurationToProto({
			actModeApiProvider: "oca",
			actModeOcaModelId: "oca-model",
			actModeOcaModelInfo: {
				modelName: "OCA Test Model",
				contextWindow: 200_000,
				maxTokens: 8_192,
				supportsImages: true,
				supportsPromptCache: true,
				supportsReasoning: true,
				reasoningEffortOptions: ["low", "medium", "high"],
				thinkingConfig: {
					maxBudget: 16_384,
					outputPrice: 1.23,
					outputPriceTiers: [{ tokenLimit: 100_000, price: 2.34 }],
				},
				temperature: 0.2,
				apiFormat: ApiFormat.OPENAI_CHAT,
			},
		})

		const config = convertProtoToApiConfiguration(proto)

		expect(config.actModeOcaModelInfo).toMatchObject({
			thinkingConfig: {
				maxBudget: 16_384,
				outputPrice: 1.23,
				outputPriceTiers: [{ tokenLimit: 100_000, price: 2.34 }],
			},
			temperature: 0.2,
		})
	})
})
