import type { ModelInfo } from "@shared/api"
import { CLINE_ONBOARDING_MODELS } from "@shared/cline/onboarding"
import { EmptyRequest } from "@shared/proto/cline/common"
import type { ClineRecommendedModel } from "@shared/proto/cline/models"
import type { OnboardingModel, OnboardingModelGroup } from "@shared/proto/cline/state"
import { useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"

export type OnboardingModelsStatus = "loading" | "success" | "empty"

export interface UseOnboardingModelsResult {
	status: OnboardingModelsStatus
	models: OnboardingModelGroup
}

function toOnboardingModel(
	rec: ClineRecommendedModel,
	group: string,
	fallbackBadge: string,
	modelCatalog: Record<string, ModelInfo>,
): OnboardingModel {
	const catalogInfo = modelCatalog[rec.id]
	const tag = rec.tags?.[0] ?? ""
	const badge = tag || fallbackBadge

	return {
		id: rec.id,
		name: rec.name || rec.id,
		group,
		badge,
		score: 0,
		latency: 0,
		info: catalogInfo
			? {
					contextWindow: catalogInfo.contextWindow ?? 0,
					supportsImages: catalogInfo.supportsImages ?? false,
					supportsPromptCache: catalogInfo.supportsPromptCache ?? false,
					inputPrice: catalogInfo.inputPrice ?? 0,
					outputPrice: catalogInfo.outputPrice ?? 0,
					tiers: catalogInfo.tiers ?? [],
				}
			: undefined,
	}
}

interface RecommendedModelsData {
	recommended: ClineRecommendedModel[]
	free: ClineRecommendedModel[]
}

type FetchState = { status: "loading" } | { status: "success"; data: RecommendedModelsData } | { status: "empty" }

export function useOnboardingModels(): UseOnboardingModelsResult {
	const { openRouterModels, clineModels, refreshClineModels } = useExtensionState()
	const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" })

	useEffect(() => {
		let cancelled = false

		const refreshRecommendedModels = async () => {
			try {
				const response = await ModelsServiceClient.refreshClineRecommendedModelsRpc(EmptyRequest.create({}))
				if (!cancelled) {
					const recommended = response.recommended ?? []
					const free = response.free ?? []
					if (recommended.length === 0 && free.length === 0) {
						setFetchState({ status: "empty" })
					} else {
						setFetchState({ status: "success", data: { recommended, free } })
					}
				}
			} catch {
				if (!cancelled) {
					setFetchState({ status: "empty" })
				}
			}
		}

		refreshRecommendedModels()

		return () => {
			cancelled = true
		}
	}, [])

	useEffect(() => {
		refreshClineModels()
	}, [refreshClineModels])

	// Merge openRouter and cline models into a single catalog for lookups
	const modelCatalog = useMemo<Record<string, ModelInfo>>(() => {
		return { ...openRouterModels, ...(clineModels ?? {}) }
	}, [openRouterModels, clineModels])

	return useMemo<UseOnboardingModelsResult>(() => {
		if (fetchState.status !== "success") {
			return { status: fetchState.status, models: { models: CLINE_ONBOARDING_MODELS } }
		}

		const { data } = fetchState
		const freeModels = data.free.map((rec) => toOnboardingModel(rec, "free", "Free", modelCatalog))
		const frontierModels = data.recommended.map((rec) => toOnboardingModel(rec, "frontier", "", modelCatalog))

		return { status: "success", models: { models: [...freeModels, ...frontierModels] } }
	}, [fetchState, modelCatalog])
}
