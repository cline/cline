import type { FeatureFlagPayload } from "@/services/feature-flags/providers/IFeatureFlagsProvider"

export enum FeatureFlag {
	CUSTOM_INSTRUCTIONS = "custom-instructions",
	DICTATION = "dictation",
	FOCUS_CHAIN_CHECKLIST = "focus_chain_checklist",
	DO_NOTHING = "do_nothing",
	HOOKS = "hooks",
	WEBTOOLS = "webtools",
	// Feature flag for showing the new onboarding flow or old welcome view.
	ONBOARDING_MODELS = "onboarding_models",
}

export const FeatureFlagDefaultValue: Partial<Record<FeatureFlag, FeatureFlagPayload>> = {
	[FeatureFlag.DO_NOTHING]: false,
	[FeatureFlag.HOOKS]: false,
	[FeatureFlag.WEBTOOLS]: false,
	[FeatureFlag.ONBOARDING_MODELS]: process.env.E2E_TEST === "true" ? { models: {} } : undefined,
}

export const FEATURE_FLAGS = Object.values(FeatureFlag)
