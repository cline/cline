export enum FeatureFlag {
	CUSTOM_INSTRUCTIONS = "custom-instructions",
	DEV_ENV_POSTHOG = "dev-env-posthog",
	DICTATION = "dictation",
	FOCUS_CHAIN_CHECKLIST = "focus_chain_checklist",
	WORKOS_AUTH = "workos_auth",
	DO_NOTHING = "do_nothing",
	HOOKS = "hooks",
}

export const FeatureFlagDefaultValue: Partial<Record<FeatureFlag, boolean>> = {
	[FeatureFlag.WORKOS_AUTH]: true,
	[FeatureFlag.DO_NOTHING]: false,
	[FeatureFlag.HOOKS]: false,
}

export const FEATURE_FLAGS = Object.values(FeatureFlag)
