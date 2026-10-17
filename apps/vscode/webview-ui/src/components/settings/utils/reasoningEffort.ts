import type { ProviderConfigResponse } from "@shared/proto/cline/models"
import { isOpenaiReasoningEffort, type OpenaiReasoningEffort } from "@shared/storage/types"
import type { ProviderConfigWritePatch } from "@/hooks/useProviderConfig"

/** Selector entry for "nothing saved": no level is requested and the provider or model default applies. */
export const DEFAULT_REASONING_EFFORT_OPTION = "default"

export type ReasoningEffortSelection = OpenaiReasoningEffort | typeof DEFAULT_REASONING_EFFORT_OPTION

/**
 * The provider's saved reasoning effort as `ReasoningEffortSelector` shows it,
 * or `null` while the provider config is still loading.
 */
export function savedReasoningEffort(config: ProviderConfigResponse | undefined): ReasoningEffortSelection | null {
	if (!config) {
		return null
	}
	return isOpenaiReasoningEffort(config.reasoningEffort) ? config.reasoningEffort : DEFAULT_REASONING_EFFORT_OPTION
}

/** The provider-config patch that saves a `ReasoningEffortSelector` choice. */
export function reasoningEffortPatch(effort: ReasoningEffortSelection): ProviderConfigWritePatch {
	if (effort === DEFAULT_REASONING_EFFORT_OPTION) {
		return { clearReasoning: true }
	}
	return effort === "none" ? { reasoning: { enabled: false, effort: "none" } } : { reasoning: { enabled: true, effort } }
}
