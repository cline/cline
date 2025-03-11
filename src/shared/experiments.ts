export const EXPERIMENT_IDS = {
	DIFF_STRATEGY: "experimentalDiffStrategy",
	SEARCH_AND_REPLACE: "search_and_replace",
	INSERT_BLOCK: "insert_content",
	POWER_STEERING: "powerSteering",
	MULTI_SEARCH_AND_REPLACE: "multi_search_and_replace",
} as const

export type ExperimentKey = keyof typeof EXPERIMENT_IDS
export type ExperimentId = valueof<typeof EXPERIMENT_IDS>

export interface ExperimentConfig {
	name: string
	description: string
	enabled: boolean
}

type valueof<X> = X[keyof X]

export const experimentConfigsMap: Record<ExperimentKey, ExperimentConfig> = {
	DIFF_STRATEGY: {
		name: "Use experimental unified diff strategy",
		description:
			"Enable the experimental unified diff strategy. This strategy might reduce the number of retries caused by model errors but may cause unexpected behavior or incorrect edits. Only enable if you understand the risks and are willing to carefully review all changes.",
		enabled: false,
	},
	SEARCH_AND_REPLACE: {
		name: "Use experimental search and replace tool",
		description:
			"Enable the experimental search and replace tool, allowing Roo to replace multiple instances of a search term in one request.",
		enabled: false,
	},
	INSERT_BLOCK: {
		name: "Use experimental insert content tool",

		description:
			"Enable the experimental insert content tool, allowing Roo to insert content at specific line numbers without needing to create a diff.",
		enabled: false,
	},
	POWER_STEERING: {
		name: 'Use experimental "power steering" mode',
		description:
			"When enabled, Roo will remind the model about the details of its current mode definition more frequently. This will lead to stronger adherence to role definitions and custom instructions, but will use more tokens per message.",
		enabled: false,
	},
	MULTI_SEARCH_AND_REPLACE: {
		name: "Use experimental multi block diff tool",
		description:
			"When enabled, Roo will use multi block diff tool. This will try to update multiple code blocks in the file in one request.",
		enabled: false,
	},
}

export const experimentDefault = Object.fromEntries(
	Object.entries(experimentConfigsMap).map(([_, config]) => [
		EXPERIMENT_IDS[_ as keyof typeof EXPERIMENT_IDS] as ExperimentId,
		config.enabled,
	]),
) as Record<ExperimentId, boolean>

export const experiments = {
	get: (id: ExperimentKey): ExperimentConfig | undefined => {
		return experimentConfigsMap[id]
	},
	isEnabled: (experimentsConfig: Record<ExperimentId, boolean>, id: ExperimentId): boolean => {
		return experimentsConfig[id] ?? experimentDefault[id]
	},
} as const

// Expose experiment details for UI - pre-compute from map for better performance
export const experimentLabels = Object.fromEntries(
	Object.entries(experimentConfigsMap).map(([_, config]) => [
		EXPERIMENT_IDS[_ as keyof typeof EXPERIMENT_IDS] as ExperimentId,
		config.name,
	]),
) as Record<string, string>

export const experimentDescriptions = Object.fromEntries(
	Object.entries(experimentConfigsMap).map(([_, config]) => [
		EXPERIMENT_IDS[_ as keyof typeof EXPERIMENT_IDS] as ExperimentId,
		config.description,
	]),
) as Record<string, string>
