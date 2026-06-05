import type { OnboardingModelGroup } from "@shared/proto/cline/state"
import { useEffect, useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"

export type OnboardingModelsStatus = "loading" | "success" | "empty"

export interface UseOnboardingModelsResult {
	status: OnboardingModelsStatus
	models: OnboardingModelGroup
}

export function useOnboardingModels(): UseOnboardingModelsResult {
	const { onboardingModels, refreshClineModels } = useExtensionState()

	useEffect(() => {
		refreshClineModels()
	}, [refreshClineModels])

	return useMemo<UseOnboardingModelsResult>(() => {
		if (!onboardingModels) {
			return { status: "loading", models: { models: [] } }
		}

		if (onboardingModels.models.length === 0) {
			return { status: "empty", models: onboardingModels }
		}

		return { status: "success", models: onboardingModels }
	}, [onboardingModels])
}
