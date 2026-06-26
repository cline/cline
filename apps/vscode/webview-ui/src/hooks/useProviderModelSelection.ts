import { type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import type { ProviderConfigResponse } from "@shared/proto/cline/models"
import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import type { Mode } from "@shared/storage/types"
import { useCallback } from "react"
import type { ProviderId } from "@/context/ExtensionStateContext"
import type { ProviderModelSelection } from "./useProviderConfig"

interface UseProviderModelSelectionOptions {
	models: Record<string, ModelInfo>
	defaultModelId?: string
	config?: ProviderConfigResponse
	commitSelection: (mode: "plan" | "act", selection: ProviderModelSelection) => Promise<unknown>
	fallbackModelInfo?: ModelInfo
	customModelInfo?: (modelId: string) => ModelInfo
}

export function useProviderModelSelection(
	providerId: ProviderId,
	currentMode: Mode,
	{
		models,
		defaultModelId,
		config,
		commitSelection,
		fallbackModelInfo = openAiModelInfoSafeDefaults,
		customModelInfo,
	}: UseProviderModelSelectionOptions,
) {
	const committedSelection = currentMode === "plan" ? config?.planSelection : config?.actSelection
	const fallbackModelId = defaultModelId || Object.keys(models)[0] || ""
	const selectedModelId = committedSelection?.modelId ?? fallbackModelId
	const persistedModelInfo = committedSelection?.modelInfo ? fromProtobufModelInfo(committedSelection.modelInfo) : undefined
	const liveModelInfo = models[selectedModelId]
	const selectedModelInfo =
		persistedModelInfo || liveModelInfo
			? {
					...persistedModelInfo,
					...liveModelInfo,
				}
			: ((selectedModelId && customModelInfo ? customModelInfo(selectedModelId) : undefined) ?? fallbackModelInfo)

	const selectedModel: ProviderModelSelection = {
		providerId,
		modelId: selectedModelId,
		modelInfo: selectedModelInfo,
	}

	const commitModelSelection = useCallback(
		(selection: Omit<ProviderModelSelection, "providerId"> | ProviderModelSelection) => {
			return commitSelection(currentMode, {
				...selection,
				providerId,
			})
		},
		[commitSelection, currentMode, providerId],
	)

	return {
		committedSelection,
		fallbackModelId,
		selectedModel,
		selectedModelId,
		selectedModelInfo,
		commitModelSelection,
	}
}
