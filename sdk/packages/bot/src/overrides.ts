/**
 * Per-turn overrides (Gateway RFC, Phase 2).
 *
 * A prompt may override parts of the bot's effective configuration for
 * that run only. Overrides never mutate the bot's stored config.
 */

import type { BotConfig } from "./identity";

export interface TurnOverrides {
	providerId?: string;
	modelId?: string;
	systemPrompt?: string;
	toolPolicies?: BotConfig["toolPolicies"];
	tools?: BotConfig["tools"];
	maxIterations?: number;
}

/** Merge per-turn overrides over the bot config into a frozen copy. */
export function resolveEffectiveConfig(
	config: BotConfig,
	overrides?: TurnOverrides,
): BotConfig {
	const effective: BotConfig = {
		...config,
		...(overrides?.providerId !== undefined
			? { providerId: overrides.providerId }
			: {}),
		...(overrides?.modelId !== undefined ? { modelId: overrides.modelId } : {}),
		...(overrides?.systemPrompt !== undefined
			? { systemPrompt: overrides.systemPrompt }
			: {}),
		...(overrides?.maxIterations !== undefined
			? { maxIterations: overrides.maxIterations }
			: {}),
		...(overrides?.toolPolicies !== undefined
			? {
					toolPolicies: {
						...config.toolPolicies,
						...overrides.toolPolicies,
					},
				}
			: {}),
		...(overrides?.tools !== undefined ? { tools: overrides.tools } : {}),
	};
	return Object.freeze(effective);
}
