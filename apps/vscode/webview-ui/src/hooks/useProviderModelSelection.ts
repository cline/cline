import { type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import type { ProviderConfigResponse } from "@shared/proto/cline/models"
import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import type { Mode } from "@shared/storage/types"
import { useCallback } from "react"
import type { ProviderId } from "@/context/ExtensionStateContext"
import type { ProviderModelSelection } from "./useProviderConfig"

type ProviderModelSelectionInput =
	| (Omit<ProviderModelSelection, "providerId"> & { modelInfo?: ModelInfo })
	| (ProviderModelSelection & { modelInfo?: ModelInfo })

interface DisplayProviderModelSelection extends ProviderModelSelection {
	modelInfo: ModelInfo
}

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
	const committedModelInfo = committedSelection?.modelInfo ? fromProtobufModelInfo(committedSelection.modelInfo) : undefined
	const freshModelInfo = models[selectedModelId]
	// The committed snapshot normally wins (it carries user per-model overrides).
	// But a generic provider's live-only models (e.g. most of Pioneer's catalog)
	// aren't in the static catalog, so their committed snapshot resolves to a
	// $0/no-metadata placeholder. In that case only — a snapshot with no pricing —
	// fall through to the freshly-resolved catalog entry so live pricing/metadata
	// show correctly. Snapshots that already carry pricing are left untouched.
	const committedHasPricing = Boolean(committedModelInfo?.inputPrice || committedModelInfo?.outputPrice)
	const selectedModelInfo =
		(committedHasPricing ? committedModelInfo : (freshModelInfo ?? committedModelInfo)) ??
		(selectedModelId && customModelInfo ? customModelInfo(selectedModelId) : undefined) ??
		fallbackModelInfo

	const selectedModel: DisplayProviderModelSelection = {
		providerId,
		modelId: selectedModelId,
		modelInfo: selectedModelInfo,
	}

	const commitModelSelection = useCallback(
		(selection: ProviderModelSelectionInput) => {
			return commitSelection(currentMode, {
				providerId,
				modelId: selection.modelId,
				...(selection.overrides !== undefined ? { overrides: selection.overrides } : {}),
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
