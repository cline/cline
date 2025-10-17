import { OpenaiReasoningEffort } from "./storage/types"

export const OPENAI_REASONING_EFFORTS: readonly OpenaiReasoningEffort[] = ["minimal", "low", "medium", "high"] as const

export type OpenaiReasoningEffortOption = (typeof OPENAI_REASONING_EFFORTS)[number]

export function normalizeReasoningEffort(value?: string | null): OpenaiReasoningEffortOption | undefined {
	if (!value) {
		return undefined
	}
	const normalized = value.trim().toLowerCase() as OpenaiReasoningEffortOption
	return OPENAI_REASONING_EFFORTS.includes(normalized) ? normalized : undefined
}

export function supportsReasoningEffortForModel(modelId?: string | null): boolean {
	if (!modelId) {
		return false
	}

	const normalized = modelId.trim().toLowerCase()
	if (!normalized) {
		return false
	}

	const withoutPrefix = normalized.startsWith("openai/") ? normalized.slice("openai/".length) : normalized
	const [baseId] = withoutPrefix.split(":")

	if (baseId.includes("gpt-5") && !baseId.includes("chat")) {
		return true
	}

	const reasoningPatterns = ["o1", "o3", "o4"]
	return reasoningPatterns.some((pattern) => {
		const boundaryPattern = new RegExp(`(^|[\\/\-])${pattern}(?:-|$)`)
		return boundaryPattern.test(baseId)
	})
}

/**
 * Resolve reasoning effort with clear fallback precedence:
 * 1. Mode-specific effort (highest priority) - from plan/act mode settings
 * 2. Model-specific default effort - from the model's configuration
 * 3. undefined (let API decide)
 */
export function resolveReasoningEffort(
	modeSpecificEffort?: string | null,
	modelSpecificDefaultEffort?: string | null,
): OpenaiReasoningEffortOption | undefined {
	// Try mode-specific first (plan/act mode setting)
	const modeResolved = normalizeReasoningEffort(modeSpecificEffort)
	if (modeResolved) {
		return modeResolved
	}

	// Try model-specific default (from model configuration)
	const modelResolved = normalizeReasoningEffort(modelSpecificDefaultEffort)
	if (modelResolved) {
		return modelResolved
	}

	// Let API decide
	return undefined
}
