import { ExperimentId } from "../schemas"
import { AssertEqual, Equals, Keys, Values } from "../utils/type-fu"

export type { ExperimentId }

export const EXPERIMENT_IDS = {
	INSERT_BLOCK: "insert_content",
	SEARCH_AND_REPLACE: "search_and_replace",
	POWER_STEERING: "powerSteering",
} as const satisfies Record<string, ExperimentId>

type _AssertExperimentIds = AssertEqual<Equals<ExperimentId, Values<typeof EXPERIMENT_IDS>>>

type ExperimentKey = Keys<typeof EXPERIMENT_IDS>

interface ExperimentConfig {
	enabled: boolean
}

export const experimentConfigsMap: Record<ExperimentKey, ExperimentConfig> = {
	INSERT_BLOCK: { enabled: false },
	SEARCH_AND_REPLACE: { enabled: false },
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
