export enum FeatureFlag {
	CUSTOM_INSTRUCTIONS = "custom-instructions",
	DEV_ENV_POSTHOG = "dev-env-posthog",
	DICTATION = "dictation",
	FOCUS_CHAIN_CHECKLIST = "focus_chain_checklist",
	WORKOS_AUTH = "workos_auth",
	DO_NOTHING = "do_nothing",
	HOOKS = "hooks",
	// Feature flag for enabling native tool calls for next-gen models
	NATIVE_TOOL_CALLS_NEXT_GEN_MODELS = "native_tool_calls_next_gen",
	// Feature flag for showing the new onboarding flow or old welcome view.
	ONBOARDING = "new_onboarding",
}

export const FeatureFlagDefaultValue: Partial<Record<FeatureFlag, boolean>> = {
	[FeatureFlag.WORKOS_AUTH]: true,
	[FeatureFlag.DO_NOTHING]: false,
	[FeatureFlag.HOOKS]: false,
	[FeatureFlag.NATIVE_TOOL_CALLS_NEXT_GEN_MODELS]: process.env.IS_DEV === "true",
	[FeatureFlag.ONBOARDING]: process.env.E2E_TEST === "true",
}

export const FEATURE_FLAGS = Object.values(FeatureFlag)
