/**
 * Capability tiering for the agent harness.
 *
 * The harness was historically tuned for Claude and gated several behaviors
 * (rich system prompt, auto-condense, mistake tolerance) behind a hard-coded
 * "next-gen" frontier list. Capable open models like DeepSeek-v4 fell through to
 * the weakest path. This module is the single source of truth for "how much can
 * we trust this model," so prompt selection, context management, and resilience
 * thresholds all derive from one decision.
 *
 * Tiers:
 *  - frontier      — Claude-4 / Gemini-2.5 / Grok-4 / GPT-5 (today's next-gen set)
 *  - capable-open  — strong open-weight models (currently DeepSeek-v4 only)
 *  - basic         — everything else (the previous GENERIC default)
 */

import { isDeepSeekV4ModelFamily, isNextGenModelFamily } from "@utils/model-utils"
import { ApiProviderInfo } from "@/core/api"

export type ModelCapabilityTier = "frontier" | "capable-open" | "basic"

export function getModelCapabilityTier(providerInfo: ApiProviderInfo): ModelCapabilityTier {
	const id = providerInfo.model.id
	if (isNextGenModelFamily(id)) {
		return "frontier"
	}
	if (isDeepSeekV4ModelFamily(id)) {
		return "capable-open"
	}
	return "basic"
}

/**
 * Whether LLM-summarization context condensing should be offered for this tier.
 * Frontier and capable-open models follow summarization instructions reliably;
 * basic models fall back to plain truncation.
 */
export function supportsAutoCondense(tier: ModelCapabilityTier): boolean {
	return tier === "frontier" || tier === "capable-open"
}

/**
 * Recommended consecutive-mistake budget before escalating. Weaker models need
 * more slack to self-correct; the effective value is max(userSetting, this).
 */
export function recommendedMaxMistakes(tier: ModelCapabilityTier): number {
	switch (tier) {
		case "frontier":
			return 3
		case "capable-open":
		case "basic":
			return 5
	}
}
