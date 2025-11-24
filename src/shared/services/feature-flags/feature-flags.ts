import type { FeatureFlagPayload } from "@/services/feature-flags/providers/IFeatureFlagsProvider"

export enum FeatureFlag {
	CUSTOM_INSTRUCTIONS = "custom-instructions",
	DICTATION = "dictation",
	FOCUS_CHAIN_CHECKLIST = "focus_chain_checklist",
	DO_NOTHING = "do_nothing",
	HOOKS = "hooks",
	// Feature flag for enabling native tool calls for next-gen models
	NATIVE_TOOL_CALLS_NEXT_GEN_MODELS = "native_tool_calls_next_gen",
	// Feature flag for showing the new onboarding flow or old welcome view.
	ONBOARDING_MODELS = "onboarding_models",
	OPENAI_NATIVE_RESPONSE_API = "openai_native_response_api",
}

export const FeatureFlagDefaultValue: Partial<Record<FeatureFlag, FeatureFlagPayload>> = {
	[FeatureFlag.DO_NOTHING]: false,
	[FeatureFlag.HOOKS]: false,
	[FeatureFlag.NATIVE_TOOL_CALLS_NEXT_GEN_MODELS]: process.env.IS_DEV === "true",
	[FeatureFlag.ONBOARDING_MODELS]: process.env.E2E_TEST === "true" ? { models: {} } : undefined,
	[FeatureFlag.OPENAI_NATIVE_RESPONSE_API]: process.env.IS_DEV === "true",
}

export const FEATURE_FLAGS = Object.values(FeatureFlag)
