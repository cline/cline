export const FEATURE_FLAGS = {
	CUSTOM_INSTRUCTIONS: "custom-instructions",
	CHECKPOINTS_TELEMETRY: "checkpoints-telemetry",
	// Further flags here
} as const

export type FeatureFlag = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS]
