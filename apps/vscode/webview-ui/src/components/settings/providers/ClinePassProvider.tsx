import {
	buildModelInfoNameMap,
	clinePassDefaultModelId,
	clinePassModels,
	type ModelInfo,
	resolveClinePassModelInfo,
} from "@shared/api"
import { EmptyRequest } from "@shared/proto/cline/common"
import type { Mode } from "@shared/storage/types"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ClineAccountInfoCard } from "../ClineAccountInfoCard"
import ClineModelPicker from "../ClineModelPicker"

interface ClinePassProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
	showAccountCard?: boolean
}

export const ClinePassProvider = ({
	showModelOptions,
	isPopup,
	currentMode,
	showAccountCard = true,
}: ClinePassProviderProps) => {
	const { openRouterModels } = useExtensionState()
	const openRouterModelsByName = useMemo(() => buildModelInfoNameMap(openRouterModels), [openRouterModels])
	const [clinePassRecommendedModels, setClinePassRecommendedModels] = useState<Record<string, ModelInfo> | undefined>(undefined)

	const refreshClinePassModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.refreshClineRecommendedModelsRpc(EmptyRequest.create({}))
			const models = Object.fromEntries(
				(response.clinePass ?? [])
					.filter((model) => model.id)
					.map((model) => {
						// ClinePass model IDs omit the upstream lab, so look up capabilities using
						// the model slug (for example, glm-5.2 instead of cline-pass/glm-5.2).
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
		} catch (error) {
			console.error("Failed to refresh ClinePass models:", error)
		}
	}, [openRouterModelsByName])

	useEffect(() => {
		void refreshClinePassModels()
	}, [refreshClinePassModels])

	const clinePassModelOptions = clinePassRecommendedModels ?? clinePassModels
	const clinePassDefaultModel = useMemo(() => {
		if (!clinePassModelOptions) {
			return undefined
		}

		return clinePassModelOptions[clinePassDefaultModelId]
			? clinePassDefaultModelId
			: (Object.keys(clinePassModelOptions)[0] ?? clinePassDefaultModelId)
	}, [clinePassModelOptions])

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
					isPopup={isPopup}
					modelIdFieldPair={{ plan: "planModeClinePassModelId", act: "actModeClinePassModelId" }}
					modelInfoFieldPair={{ plan: "planModeClinePassModelInfo", act: "actModeClinePassModelInfo" }}
					models={clinePassModelOptions}
					showFeaturedModels={false}
				/>
			)}
		</div>
	)
}
