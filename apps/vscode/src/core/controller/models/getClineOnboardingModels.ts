import { OnboardingModelGroup } from "@/shared/proto/cline/state"

export function getClineOnboardingModels(): OnboardingModelGroup {
	return OnboardingModelGroup.create({})
}

export function clearOnboardingModelsCache(): void {
	return
}
