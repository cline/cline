export type ExtensionVariant = "legacy" | "next"

export interface RolloutTelemetryMetadata {
	extension_variant: ExtensionVariant
	rollout_version?: string
}

export interface RolloutBundleActivation {
	attemptedBundle: ExtensionVariant
	actualBundle: ExtensionVariant
	fallback: boolean
	error?: unknown
	decisionReason?:
		| "env_override"
		| "setting_override"
		| "killswitch"
		| "previous_failure"
		| "cached_next"
		| "cached_legacy"
		| "default_legacy"
	loaderVersion?: string
	vscodeVersion?: string
	msSinceLastActivation?: number
	override?: "env" | "setting"
}

export const ROLLOUT_BUNDLE_ACTIVATED_EVENT = "extension.rollout.bundle_activated"
export const ROLLOUT_ERROR_TYPE_LIMIT = 64

/** Return rollout metadata only for bundles built by the combined rollout workflow. */
export function getRolloutTelemetryMetadata(): Partial<RolloutTelemetryMetadata> {
	const variant = process.env.CLINE_ROLLOUT_VARIANT
	const rolloutVersion = process.env.CLINE_ROLLOUT_VERSION

	if (variant !== "legacy" && variant !== "next") {
		return {}
	}

	return {
		extension_variant: variant,
		...(rolloutVersion ? { rollout_version: rolloutVersion } : {}),
	}
}

export function attachRolloutTelemetryMetadata(event: {
	properties?: Record<string, unknown>
}): void {
	event.properties = {
		...event.properties,
		...getRolloutTelemetryMetadata(),
	}
}

export function getRolloutErrorProperties(error: unknown): {
	error_type: string
} {
	if (error instanceof Error) {
		return {
			error_type: normalizeRolloutErrorType(error.name, "Error"),
		}
	}

	return {
		error_type: error === undefined ? "unknown" : error === null ? "null" : typeof error,
	}
}

function normalizeRolloutErrorType(value: string, fallback: string): string {
	return value.length > 0 && value.length <= ROLLOUT_ERROR_TYPE_LIMIT && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value)
		? value
		: fallback
}
