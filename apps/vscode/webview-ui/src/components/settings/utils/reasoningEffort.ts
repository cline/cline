import type { OpenaiReasoningEffort } from "@shared/storage/types"
import type { ProviderConfigWritePatch } from "@/hooks/useProviderConfig"

/** Selector entry for "nothing saved": no level is requested and the provider or model default applies. */
export const DEFAULT_REASONING_EFFORT_OPTION = "default"

export type ReasoningEffortSelection = OpenaiReasoningEffort | typeof DEFAULT_REASONING_EFFORT_OPTION

/** The provider-config patch that saves a `ReasoningEffortSelector` choice. */
export function reasoningEffortPatch(effort: ReasoningEffortSelection): ProviderConfigWritePatch {
	if (effort === DEFAULT_REASONING_EFFORT_OPTION) {
		return { clearReasoning: true }
	}
	return effort === "none" ? { reasoning: { enabled: false, effort: "none" } } : { reasoning: { enabled: true, effort } }
}
