import type { FeatureFlagPayload } from "@/services/feature-flags/providers/IFeatureFlagsProvider"

export enum FeatureFlag {
	WEBTOOLS = "webtools",
	WORKTREES = "worktree-exp",
	// Feature flag for showing the new onboarding flow or old welcome view.
	ONBOARDING_MODELS = "onboarding_models",
}

export const FeatureFlagDefaultValue: Partial<Record<FeatureFlag, FeatureFlagPayload>> = {
	[FeatureFlag.WEBTOOLS]: false,
	[FeatureFlag.WORKTREES]: false,
	[FeatureFlag.ONBOARDING_MODELS]: process.env.E2E_TEST === "true" ? { models: {} } : undefined,
}

export const FEATURE_FLAGS = Object.values(FeatureFlag)
