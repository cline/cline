import {
	buildModelInfoNameMap,
	clinePassDefaultModelId,
	clinePassModelInfoSaneDefaults,
	clinePassModels,
	type ModelInfo,
	resolveClinePassModelInfo,
} from "@shared/api"
import { CLINE_RECOMMENDED_MODELS_FALLBACK } from "@shared/cline/recommended-models"
import { EmptyRequest } from "@shared/proto/cline/common"
import type { ClineRecommendedModel } from "@shared/proto/cline/models"
import type { Mode } from "@shared/storage/types"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ClineAccountInfoCard } from "../ClineAccountInfoCard"
import ClineModelPicker, { type FeaturedModelCardEntry, toFeaturedModelCardEntry } from "../ClineModelPicker"
import FeaturedModelCard from "../FeaturedModelCard"
import { getModeSpecificFields } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface ClinePassProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
	showAccountCard?: boolean
}

const CLINE_PASS_MODEL_FIELD_PAIRS = {
	modelId: { plan: "planModeClinePassModelId", act: "actModeClinePassModelId" },
	modelInfo: { plan: "planModeClinePassModelInfo", act: "actModeClinePassModelInfo" },
} as const

function zeroPriced(info: ModelInfo): ModelInfo {
	return {
		...info,
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		cacheWritesPrice: 0,
	}
}

export const ClinePassProvider = ({
	showModelOptions,
	isPopup,
	currentMode,
	showAccountCard = true,
}: ClinePassProviderProps) => {
	const { apiConfiguration, openRouterModels, clineModels, refreshClineModels } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const openRouterModelsByName = useMemo(() => buildModelInfoNameMap(openRouterModels), [openRouterModels])
	const [clinePassRecommendedModels, setClinePassRecommendedModels] = useState<Record<string, ModelInfo> | undefined>(undefined)
	const [clineFreeModels, setClineFreeModels] = useState<ClineRecommendedModel[]>([])

	const refreshClinePassModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.refreshClineRecommendedModelsRpc(EmptyRequest.create({}))
			const models = Object.fromEntries(
				(response.clinePass ?? [])
					.filter((model) => model.id)
					.map((model) => {
						// ClinePass model IDs omit the upstream lab, so look up capabilities using
						// the model slug (for example, glm-5.1 instead of cline-pass/glm-5.1).
						// If the model is not in OpenRouter yet, use conservative generic defaults
						// instead of copying GLM-5.1-specific context/max-token values.
						const fallback = resolveClinePassModelInfo(model.id, openRouterModelsByName)
						return [
							model.id,
							{
								...fallback,
								name: model.name || fallback.name || model.id,
								description: model.description || fallback.description,
							},
						]
					}),
			)
			setClinePassRecommendedModels(Object.keys(models).length > 0 ? models : undefined)
			setClineFreeModels((response.free ?? []).filter((model) => model.id))
		} catch (error) {
			console.error("Failed to refresh ClinePass models:", error)
		}
	}, [openRouterModelsByName])

	useEffect(() => {
		void refreshClinePassModels()
	}, [refreshClinePassModels])

	// The picker skips its own catalog refresh when a models map is provided, but the
	// free-model entries below resolve their capabilities from the cline catalog.
	useEffect(() => {
		refreshClineModels()
	}, [refreshClineModels])

	const freeRecommendedModels = useMemo(
		() => (clineFreeModels.length > 0 ? clineFreeModels : CLINE_RECOMMENDED_MODELS_FALLBACK.free),
		[clineFreeModels],
	)

	// Free models are OpenRouter-style ids billed at $0, so resolve their info by full id
	// from the dynamic catalogs and store them zero-priced.
	const freeModelEntries = useMemo(() => {
		const modelCatalog: Record<string, ModelInfo> = { ...openRouterModels, ...clineModels }
		return Object.fromEntries(
			freeRecommendedModels
				.filter((model) => model.id)
				.map((model) => {
					const base = modelCatalog[model.id] ?? clinePassModelInfoSaneDefaults
					return [
						model.id,
						zeroPriced({
							...base,
							name: model.name || base.name || model.id,
							description: model.description || base.description,
						}),
					]
				}),
		)
	}, [freeRecommendedModels, openRouterModels, clineModels])

	const { clinePassModelId: configuredClinePassModelId, clinePassModelInfo: configuredClinePassModelInfo } =
		getModeSpecificFields(apiConfiguration, currentMode)

	const clinePassModelOptions = useMemo(() => {
		// ClinePass entries first so the default-model fallback below stays a pass model.
		const merged: Record<string, ModelInfo> = { ...(clinePassRecommendedModels ?? clinePassModels), ...freeModelEntries }
		// Keep a previously selected model visible even if it later drops out of the
		// endpoint's buckets, so the picker doesn't display a model the host won't send.
		if (configuredClinePassModelId && !(configuredClinePassModelId in merged) && configuredClinePassModelInfo) {
			merged[configuredClinePassModelId] = configuredClinePassModelInfo
		}
		return merged
	}, [clinePassRecommendedModels, freeModelEntries, configuredClinePassModelId, configuredClinePassModelInfo])

	const clinePassDefaultModel = useMemo(() => {
		if (!clinePassModelOptions) {
			return undefined
		}

		return clinePassModelOptions[clinePassDefaultModelId]
			? clinePassDefaultModelId
			: (Object.keys(clinePassModelOptions)[0] ?? clinePassDefaultModelId)
	}, [clinePassModelOptions])

	const selectedModelId =
		configuredClinePassModelId && configuredClinePassModelId in clinePassModelOptions
			? configuredClinePassModelId
			: clinePassDefaultModel

	const freeModelCards = useMemo(
		() =>
			freeRecommendedModels
				.map((model) => toFeaturedModelCardEntry(model, "FREE"))
				.filter((model): model is FeaturedModelCardEntry => model !== null),
		[freeRecommendedModels],
	)

	const handleFreeModelSelect = (modelId: string) => {
		handleModeFieldsChange(
			{
				clineModelId: CLINE_PASS_MODEL_FIELD_PAIRS.modelId,
				clineModelInfo: CLINE_PASS_MODEL_FIELD_PAIRS.modelInfo,
			},
			{
				clineModelId: modelId,
				clineModelInfo: clinePassModelOptions[modelId],
			},
			currentMode,
		)
	}

	return (
		<div>
			{showAccountCard && (
				<div style={{ marginBottom: 14, marginTop: 4 }}>
					<ClineAccountInfoCard />
				</div>
			)}

			{showModelOptions && (
				<>
					<ClineModelPicker
						currentMode={currentMode}
						defaultModelId={clinePassDefaultModel}
						isPopup={isPopup}
						modelIdFieldPair={CLINE_PASS_MODEL_FIELD_PAIRS.modelId}
						modelInfoFieldPair={CLINE_PASS_MODEL_FIELD_PAIRS.modelInfo}
						models={clinePassModelOptions}
						showFeaturedModels={false}
					/>
					{freeModelCards.length > 0 && (
						<div style={{ marginTop: 10 }}>
							<span style={{ fontWeight: 500 }}>Free models</span>
							<div style={{ marginTop: 4 }}>
								{freeModelCards.map((model) => (
									<FeaturedModelCard
										description={model.description}
										isSelected={selectedModelId === model.id}
										key={model.id}
										label={model.label}
										modelId={model.id}
										onClick={() => handleFreeModelSelect(model.id)}
									/>
								))}
							</div>
						</div>
					)}
				</>
			)}
		</div>
	)
}
