export type ExtensionVariant = "legacy" | "next"

export interface RolloutTelemetryMetadata {
	extension_variant: ExtensionVariant
}

export interface RolloutBundleActivation {
	attemptedBundle: ExtensionVariant
	actualBundle: ExtensionVariant
	fallback: boolean
	error?: unknown
}

export const ROLLOUT_BUNDLE_ACTIVATED_EVENT = "extension.rollout.bundle_activated"
export const ROLLOUT_ERROR_MESSAGE_LIMIT = 500

/** Return rollout metadata only for bundles built by the combined rollout workflow. */
export function getRolloutTelemetryMetadata(): Partial<RolloutTelemetryMetadata> {
	const variant = process.env.CLINE_ROLLOUT_VARIANT

	if (variant !== "legacy" && variant !== "next") {
		return {}
	}

	return { extension_variant: variant }
}

export function getRolloutErrorProperties(error: unknown): {
	error_type: string
	error_message: string
} {
	if (error instanceof Error) {
		return {
			error_type: error.name || "Error",
			error_message: error.message.slice(0, ROLLOUT_ERROR_MESSAGE_LIMIT),
		}
	}

	return {
		error_type: error === undefined ? "unknown" : error === null ? "null" : typeof error,
		error_message: (error === undefined ? "Unknown activation error" : String(error)).slice(0, ROLLOUT_ERROR_MESSAGE_LIMIT),
	}
}
