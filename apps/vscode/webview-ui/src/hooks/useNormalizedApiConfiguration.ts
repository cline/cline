import { BEDROCK_DEFAULT_MODEL_ID } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { useMemo } from "react"
import type { NormalizedApiConfig } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"

export function useNormalizedApiConfiguration(mode: Mode): NormalizedApiConfig {
	const { apiConfiguration, bedrockStartup } = useExtensionState()
	const modelId =
		(mode === "plan" ? apiConfiguration?.planModeApiModelId : apiConfiguration?.actModeApiModelId) ?? BEDROCK_DEFAULT_MODEL_ID
	const selectedTarget = bedrockStartup?.selectedTarget?.invocationId === modelId ? bedrockStartup.selectedTarget : undefined

	return useMemo(
		() => ({
			selectedProvider: "bedrock",
			selectedModelId: modelId,
			selectedModelInfo: {
				name: selectedTarget?.displayName ?? modelId,
				supportsImages: selectedTarget?.inputModalities.some((modality) => modality.toUpperCase() === "IMAGE"),
				supportsPromptCache: false,
			},
		}),
		[modelId, selectedTarget],
	)
}
