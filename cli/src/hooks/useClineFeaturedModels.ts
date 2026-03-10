import { useEffect, useState } from "react"
import { refreshClineRecommendedModels } from "@/core/controller/models/refreshClineRecommendedModels"
import {
	type FeaturedModel,
	getAllFeaturedModels,
	mapRecommendedModelsToFeaturedModels,
	withFeaturedModelFallback,
} from "../constants/featured-models"

export function useClineFeaturedModels(): FeaturedModel[] {
	const [featuredModels, setFeaturedModels] = useState<FeaturedModel[]>(() => getAllFeaturedModels())

	useEffect(() => {
		let cancelled = false
		void (async () => {
			try {
				const recommendedModels = await refreshClineRecommendedModels()
				const mappedModels = mapRecommendedModelsToFeaturedModels(recommendedModels)
				const modelsWithFallback = withFeaturedModelFallback(mappedModels)
				if (!cancelled) {
					setFeaturedModels(getAllFeaturedModels(modelsWithFallback))
				}
			} catch {
				// Keep local fallback models on error.
			}
		})()

		return () => {
			cancelled = true
		}
	}, [])

	return featuredModels
}
