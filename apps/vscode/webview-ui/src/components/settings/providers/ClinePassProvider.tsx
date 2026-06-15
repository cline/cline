import { clinePassDefaultModelId, clinePassModels, ModelInfo } from "@shared/api"
import { EmptyRequest } from "@shared/proto/cline/common"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"
import ClineModelPicker from "../ClineModelPicker"
import { ClineProvider } from "./ClineProvider"

export const ClinePassProvider: typeof ClineProvider = (props) => {
	const [clinePassRecommendedModels, setClinePassRecommendedModels] = useState<Record<string, ModelInfo> | undefined>(undefined)

	const refreshClinePassModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.refreshClineRecommendedModelsRpc(EmptyRequest.create({}))
			const models = Object.fromEntries(
				(response.clinePass ?? [])
					.filter((model) => model.id)
					.map((model) => {
						const fallback = clinePassModels[model.id as keyof typeof clinePassModels]
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
			console.error("Failed to refresh Cline Pass models:", error)
		}
	}, [])

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
		<ClineModelPicker
			{...props}
			defaultModelId={clinePassDefaultModel}
			models={clinePassRecommendedModels}
			showFeaturedModels={false}
		/>
	)
}
