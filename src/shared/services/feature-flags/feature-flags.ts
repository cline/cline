export enum FeatureFlag {
	CUSTOM_INSTRUCTIONS = "custom-instructions",
	DEV_ENV_POSTHOG = "dev-env-posthog",
	FOCUS_CHAIN_CHECKLIST = "focus_chain_checklist",
	MULTI_ROOT_WORKSPACE = "multi_root_workspace",
}

export const FEATURE_FLAGS = Object.values(FeatureFlag)
