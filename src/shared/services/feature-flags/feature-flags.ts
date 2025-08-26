export enum FeatureFlag {
	CUSTOM_INSTRUCTIONS = "custom-instructions",
	DEV_ENV_POSTHOG = "dev-env-posthog",
	FOCUS_CHAIN_CHECKLIST = "focus_chain_checklist",
}

export const FEATURE_FLAGS = Object.values(FeatureFlag)
