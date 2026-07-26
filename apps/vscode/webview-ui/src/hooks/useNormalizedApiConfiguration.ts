import { BEDROCK_DEFAULT_MODEL_ID, type ModelInfo } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { useMemo } from "react"
import type { NormalizedApiConfig } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"

const BEDROCK_MODEL_INFO: Record<string, ModelInfo> = {
	"anthropic.claude-sonnet-4-6": {
		name: "Claude Sonnet 4.6",
		maxTokens: 64_000,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoning: true,
	},
	"anthropic.claude-opus-4-6-v1": {
		name: "Claude Opus 4.6",
		maxTokens: 128_000,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoning: true,
	},
	"anthropic.claude-haiku-4-5-20251001-v1:0": {
		name: "Claude Haiku 4.5",
		maxTokens: 64_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoning: true,
	},
}

export function useNormalizedApiConfiguration(mode: Mode): NormalizedApiConfig {
	const { apiConfiguration } = useExtensionState()
	const modelId =
		(mode === "plan" ? apiConfiguration?.planModeApiModelId : apiConfiguration?.actModeApiModelId) ?? BEDROCK_DEFAULT_MODEL_ID

	return useMemo(
		() => ({
			selectedProvider: "bedrock",
			selectedModelId: modelId,
			selectedModelInfo: BEDROCK_MODEL_INFO[modelId] ?? {
				name: modelId,
				supportsPromptCache: false,
			},
		}),
		[modelId],
	)
}
