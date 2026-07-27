import { type ApiConfiguration, type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { useMemo } from "react"
import { useProviderModels } from "./useProviderModels"
import { useProviderUsageCostDisplay } from "./useProviderUsageCostDisplay"

export interface StaticProviderSelectionOptions {
	/**
	 * Optional saved model id override. When provided, the hook reads
	 * selection from this value instead of the common
	 * `{plan,act}ModeApiModelId` field. Used by providers that maintain
	 * a provider-specific saved id field (e.g. `planModeFireworksModelId`).
	 */
	savedModelId?: string
}

/**
 * Shared selection logic for provider components whose:
 *   - model list is driven by the SDK via gRPC (`useProviderModels`).
 *   - model id is stored in `{plan,act}ModeApiModelId` by default, or in
 *     a provider-specific field passed via `savedModelId` option.
 *
 * Honors the user's saved model id when it still exists in the SDK
 * catalog; otherwise falls through to the SDK-declared default. While
 * the catalog is still loading or the saved id is unknown, returns sane
 * defaults so the UI does not flicker.
 *
 * `hideUsageCost` is sourced from the SDK's
 * `ProviderListing.usage_cost_display` (see `useProviderUsageCostDisplay`),
 * so consumers must pass the returned value through to
 * `<ModelInfoView hideUsageCost={...} />` instead of hard-coding any
 * per-provider knowledge.
 */
export function useStaticProviderSelection(
	providerId: string,
	apiConfiguration: ApiConfiguration | undefined,
	currentMode: Mode,
	options: StaticProviderSelectionOptions = {},
): {
	models: Record<string, ModelInfo>
	defaultModelId: string
	selectedModelId: string
	selectedModelInfo: ModelInfo
	hideUsageCost: boolean
} {
	const { models, defaultModelId } = useProviderModels(providerId)
	const hideUsageCost = useProviderUsageCostDisplay(providerId) === "hide"

	const fallbackSavedModelId =
		currentMode === "plan" ? apiConfiguration?.planModeApiModelId : apiConfiguration?.actModeApiModelId
	const savedModelId = options.savedModelId ?? fallbackSavedModelId

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		if (savedModelId && models[savedModelId]) {
			return { selectedModelId: savedModelId, selectedModelInfo: models[savedModelId] }
		}
		if (defaultModelId && models[defaultModelId]) {
			return { selectedModelId: defaultModelId, selectedModelInfo: models[defaultModelId] }
		}
		return {
			selectedModelId: savedModelId || defaultModelId || "",
			selectedModelInfo: openAiModelInfoSafeDefaults,
		}
	}, [savedModelId, defaultModelId, models])

	return { models, defaultModelId, selectedModelId, selectedModelInfo, hideUsageCost }
}
