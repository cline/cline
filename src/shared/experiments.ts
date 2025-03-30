import { ExperimentId } from "../schemas"
import { AssertEqual, Equals, Keys, Values } from "../utils/type-fu"

export type { ExperimentId }

export const EXPERIMENT_IDS = {
	DIFF_STRATEGY_SEARCH_AND_REPLACE: "search_and_replace",
	DIFF_STRATEGY_UNIFIED: "experimentalDiffStrategy",
	DIFF_STRATEGY_MULTI_SEARCH_AND_REPLACE: "multi_search_and_replace",
	INSERT_BLOCK: "insert_content",
	POWER_STEERING: "powerSteering",
} as const satisfies Record<string, ExperimentId>

type _AssertExperimentIds = AssertEqual<Equals<ExperimentId, Values<typeof EXPERIMENT_IDS>>>

type ExperimentKey = Keys<typeof EXPERIMENT_IDS>

interface ExperimentConfig {
	enabled: boolean
}

export const experimentConfigsMap: Record<ExperimentKey, ExperimentConfig> = {
	DIFF_STRATEGY_SEARCH_AND_REPLACE: { enabled: false },
	DIFF_STRATEGY_UNIFIED: { enabled: false },
	DIFF_STRATEGY_MULTI_SEARCH_AND_REPLACE: { enabled: false },
	INSERT_BLOCK: { enabled: false },
	POWER_STEERING: { enabled: false },
}

export const experimentDefault = Object.fromEntries(
	Object.entries(experimentConfigsMap).map(([_, config]) => [
		EXPERIMENT_IDS[_ as keyof typeof EXPERIMENT_IDS] as ExperimentId,
		config.enabled,
	]),
) as Record<ExperimentId, boolean>

export const experiments = {
	get: (id: ExperimentKey): ExperimentConfig | undefined => experimentConfigsMap[id],
	isEnabled: (experimentsConfig: Record<ExperimentId, boolean>, id: ExperimentId) =>
		experimentsConfig[id] ?? experimentDefault[id],
} as const
