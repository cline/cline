export enum FeatureFlag {
	CUSTOM_INSTRUCTIONS = "custom-instructions",
	DEV_ENV_POSTHOG = "dev-env-posthog",
	DICTATION = "dictation",
	FOCUS_CHAIN_CHECKLIST = "focus_chain_checklist",
	MULTI_ROOT_WORKSPACE = "multi_root_workspace",
	WORKOS_AUTH = "workos_auth",
	DO_NOTHING = "do_nothing",
}

export const FEATURE_FLAGS = Object.values(FeatureFlag)
