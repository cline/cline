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
	allowsCustomIds?: boolean
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
		allowsCustomIds = true,
		fallbackModelInfo = openAiModelInfoSafeDefaults,
		customModelInfo,
	}: UseProviderModelSelectionOptions,
) {
	const committedSelection = currentMode === "plan" ? config?.planSelection : config?.actSelection
	const fallbackModelId = defaultModelId || Object.keys(models)[0] || ""
	const committedModelId = committedSelection?.modelId
	const selectedModelId =
		committedModelId && (allowsCustomIds || committedModelId in models) ? committedModelId : fallbackModelId
	const selectedModelInfo =
		committedSelection?.modelInfo && selectedModelId === committedModelId
			? fromProtobufModelInfo(committedSelection.modelInfo)
			: (models[selectedModelId] ??
				(selectedModelId && customModelInfo ? customModelInfo(selectedModelId) : undefined) ??
				fallbackModelInfo)

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
