import type { FeatureFlagPayload } from "@/services/feature-flags/providers/IFeatureFlagsProvider"

export enum FeatureFlag {
	WEBTOOLS = "webtools",
	WORKTREES = "worktree-exp",
	// Feature flag for showing the new onboarding flow or old welcome view.
	ONBOARDING_MODELS = "onboarding_models",
	// Feature flag for remote banner service
	REMOTE_BANNERS = "remote-banners",
	// Feature flag for DB-backed welcome banners (What's New modal)
	// When off, hardcoded welcome items are shown instead
	REMOTE_WELCOME_BANNERS = "remote-welcome-banners",
}

export const FeatureFlagDefaultValue: Partial<Record<FeatureFlag, FeatureFlagPayload>> = {
	[FeatureFlag.WEBTOOLS]: false,
	[FeatureFlag.WORKTREES]: false,
	[FeatureFlag.ONBOARDING_MODELS]: process.env.E2E_TEST === "true" ? { models: {} } : undefined,
	[FeatureFlag.REMOTE_BANNERS]: process.env.E2E_TEST === "true" || process.env.IS_DEV === "true",
	[FeatureFlag.REMOTE_WELCOME_BANNERS]: process.env.E2E_TEST === "true" || process.env.IS_DEV === "true",
}

export const FEATURE_FLAGS = Object.values(FeatureFlag)
