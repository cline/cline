import type { ApiProvider } from "@shared/api"
import { describe, expect, it } from "vitest"
import { convertApiConfigurationToProto, convertProtoToApiConfiguration } from "./api-configuration-conversion"
import { fromProtobufModelInfo, toProtobufModelInfo } from "./typeConversion"

describe("api configuration provider conversion", () => {
	it("round-trips SDK provider ids added after the legacy enum list", () => {
		const providers: ApiProvider[] = ["poolside", "v0", "xiaomi", "tencent-tokenhub", "chutes", "zai-coding-plan"]

		for (const provider of providers) {
			const proto = convertApiConfigurationToProto({
				actModeApiProvider: provider,
				planModeApiProvider: provider,
			})

			// Assert field-by-field instead of toMatchObject: this file is also picked up by
			// the mocha integration runner (.vscode-test.mjs globs src/shared/**/*.test.js),
			// where vitest's jest-compat matchers like toMatchObject are not available.
			const result = convertProtoToApiConfiguration(proto)
			expect(result.actModeApiProvider).toBe(provider)
			expect(result.planModeApiProvider).toBe(provider)
		}
	})

	it("round-trips LiteLLM request routing metadata", () => {
		const proto = convertApiConfigurationToProto({
			actModeApiProvider: "litellm",
			actModeLiteLlmModelId: "xai/grok-4.6",
			actModeLiteLlmModelInfo: {
				name: "xai/grok-4.6",
				requestModelId: "openai/grok-4.6",
				contextWindow: 500_000,
				maxTokens: 64_000,
				supportsPromptCache: false,
			},
		})

		expect(proto.actModeLiteLlmModelInfo?.requestModelId).toBe("openai/grok-4.6")
		const result = convertProtoToApiConfiguration(proto)
		expect(result.actModeLiteLlmModelId).toBe("xai/grok-4.6")
		expect(result.actModeLiteLlmModelInfo?.requestModelId).toBe("openai/grok-4.6")
	})

	it("round-trips request routing metadata through provider model responses", () => {
		const proto = toProtobufModelInfo({
			name: "xai/grok-4.6",
			requestModelId: "openai/grok-4.6",
			supportsPromptCache: false,
		})

		expect(proto.requestModelId).toBe("openai/grok-4.6")
		expect(fromProtobufModelInfo(proto).requestModelId).toBe("openai/grok-4.6")
	})
})
