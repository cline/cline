import {
	buildModelInfoNameMap,
	clinePassDefaultModelId,
	clinePassModelInfoSaneDefaults,
	clinePassModels,
	getModelSlug,
	type ModelInfo,
	resolveClinePassModelInfo,
} from "@shared/api"
import { formatClineFreeModelName, zeroPricedModelInfo } from "@shared/cline/free-models"
import { CLINE_RECOMMENDED_MODELS_FALLBACK } from "@shared/cline/recommended-models"
import { EmptyRequest } from "@shared/proto/cline/common"
import type { ClineRecommendedModel } from "@shared/proto/cline/models"
import type { Mode } from "@shared/storage/types"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ClineAccountInfoCard } from "../ClineAccountInfoCard"
import ClineModelPicker, {
	type FeaturedModelCardEntry,
	type FeaturedModelTab,
	toFeaturedModelCardEntry,
} from "../ClineModelPicker"
import { getModeSpecificFields } from "../utils/providerUtils"

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

const FREE_TAB_DESCRIPTION =
	"Try these models with limited free usage, included at no cost and separate from your ClinePass quota."

// Cline free models come back as either full OpenRouter-style ids or cline-free/ ids,
// so resolve capabilities by full id first and fall back to the slug map (cline-free
// ids share their slug with the paid catalog entry).
function resolveFreeModelInfo(
	modelId: string,
	modelCatalog: Record<string, ModelInfo>,
	modelCatalogByName: Record<string, ModelInfo>,
): ModelInfo {
	return modelCatalog[modelId] ?? modelCatalogByName[getModelSlug(modelId)] ?? clinePassModelInfoSaneDefaults
}

export const ClinePassProvider = ({ showModelOptions, isPopup, currentMode, showAccountCard = true }: ClinePassProviderProps) => {
	const { apiConfiguration, openRouterModels, clineModels, refreshClineModels } = useExtensionState()
	const openRouterModelsByName = useMemo(() => buildModelInfoNameMap(openRouterModels), [openRouterModels])
	const [clinePassRawModels, setClinePassRawModels] = useState<ClineRecommendedModel[]>([])
	const [clinePassRecommendedModels, setClinePassRecommendedModels] = useState<Record<string, ModelInfo> | undefined>(undefined)
	const [clineFreeModels, setClineFreeModels] = useState<ClineRecommendedModel[]>([])

	const refreshClinePassModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.refreshClineRecommendedModelsRpc(EmptyRequest.create({}))
			const clinePassResponseModels = (response.clinePass ?? []).filter((model) => model.id)
			const models = Object.fromEntries(
				clinePassResponseModels.map((model) => {
					// ClinePass model IDs omit the upstream lab, so look up capabilities using
					// the model slug (for example, glm-5.2 instead of cline-pass/glm-5.2).
					// If the model is not in OpenRouter yet, use conservative generic defaults
					// instead of copying GLM-5.2-specific context/max-token values.
					const fallback = resolveClinePassModelInfo(model.id, openRouterModelsByName)
					return [
						model.id,
						{
							...fallback,
							name: model.name || fallback.name || model.id,
							// The info panel shows the full catalog description; the endpoint's
							// short blurb is only for the featured cards
							description: fallback.description || model.description,
						},
					]
				}),
			)
			setClinePassRawModels(clinePassResponseModels)
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

	// Free models are OpenRouter-style ids or cline-free/ ids billed at $0, so resolve
	// their info from the dynamic catalogs and store them zero-priced.
	const freeModelEntries = useMemo(() => {
		const modelCatalog: Record<string, ModelInfo> = { ...openRouterModels, ...clineModels }
		const modelCatalogByName = buildModelInfoNameMap(modelCatalog)
		return Object.fromEntries(
			freeRecommendedModels
				.filter((model) => model.id)
				.map((model) => {
					const base = resolveFreeModelInfo(model.id, modelCatalog, modelCatalogByName)
					const name = model.name || base.name || model.id
					return [
						model.id,
						zeroPricedModelInfo({
							...base,
							// cline-free/ models are explicitly marked so they can be told
							// apart from their paid counterpart, which shares the slug
							name: formatClineFreeModelName(model.id, name),
							// The info panel shows the full catalog description; the endpoint's
							// short blurb is only for the featured cards
							description: base.description || model.description,
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

	// Subscription models show their endpoint description but no label chip — the
	// whole list is included with the plan, so a per-card tag adds nothing
	const subscribedModelCards = useMemo<FeaturedModelCardEntry[]>(() => {
		const models =
			clinePassRawModels.length > 0
				? clinePassRawModels.map((model) => ({ id: model.id, description: model.description }))
				: Object.entries(clinePassRecommendedModels ?? clinePassModels).map(([id, info]) => ({
						id,
						description: info.description,
					}))
		return models.map((model) => ({
			id: model.id,
			displayName: model.id.replace(/^cline-pass\//, ""),
			label: "",
			description: model.description || "",
		}))
	}, [clinePassRawModels, clinePassRecommendedModels])

	const freeModelCards = useMemo(
		() =>
			freeRecommendedModels
				.map((model) => toFeaturedModelCardEntry(model, "FREE"))
				.filter((model): model is FeaturedModelCardEntry => model !== null),
		[freeRecommendedModels],
	)

	const featuredTabs = useMemo<FeaturedModelTab[]>(() => {
		const tabs: FeaturedModelTab[] = [{ label: "Subscribed", models: subscribedModelCards }]
		if (freeModelCards.length > 0) {
			tabs.push({ label: "Free", models: freeModelCards, description: FREE_TAB_DESCRIPTION })
		}
		return tabs
	}, [subscribedModelCards, freeModelCards])

	return (
		<div>
			{showAccountCard && (
				<div style={{ marginBottom: 14, marginTop: 4 }}>
					<ClineAccountInfoCard />
				</div>
			)}

			{showModelOptions && (
				<ClineModelPicker
					currentMode={currentMode}
					defaultModelId={clinePassDefaultModel}
					featuredTabs={featuredTabs}
					isPopup={isPopup}
					modelIdFieldPair={CLINE_PASS_MODEL_FIELD_PAIRS.modelId}
					modelInfoFieldPair={CLINE_PASS_MODEL_FIELD_PAIRS.modelInfo}
					models={clinePassModelOptions}
				/>
			)}
		</div>
	)
}
