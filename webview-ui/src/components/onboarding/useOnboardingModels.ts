import type { ModelInfo } from "@shared/api"
import { CLINE_ONBOARDING_MODELS } from "@shared/cline/onboarding"
import { EmptyRequest } from "@shared/proto/cline/common"
import type { ClineRecommendedModel } from "@shared/proto/cline/models"
import type { OnboardingModel, OnboardingModelGroup } from "@shared/proto/cline/state"
import { useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"

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

export function useOnboardingModels(): OnboardingModelGroup {
	const { openRouterModels, clineModels, refreshClineModels } = useExtensionState()
	const [data, setData] = useState<RecommendedModelsData | null>(null)

	useEffect(() => {
		let cancelled = false

		const refreshRecommendedModels = async () => {
			try {
				const response = await ModelsServiceClient.refreshClineRecommendedModelsRpc(EmptyRequest.create({}))
				if (!cancelled) {
					setData({ recommended: response.recommended ?? [], free: response.free ?? [] })
				}
			} catch {}
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

	return useMemo<OnboardingModelGroup>(() => {
		if (!data || (data.recommended.length === 0 && data.free.length === 0)) {
			return { models: CLINE_ONBOARDING_MODELS }
		}

		const freeModels = data.free.map((rec) => toOnboardingModel(rec, "free", "Free", modelCatalog))
		const frontierModels = data.recommended.map((rec) => toOnboardingModel(rec, "frontier", "", modelCatalog))

		return { models: [...freeModels, ...frontierModels] }
	}, [data, modelCatalog])
}
