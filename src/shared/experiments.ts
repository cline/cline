export const EXPERIMENT_IDS = {
	DIFF_STRATEGY: "experimentalDiffStrategy",
	SEARCH_AND_REPLACE: "search_and_replace",
	INSERT_BLOCK: "insert_code_block",
} as const

export type ExperimentKey = keyof typeof EXPERIMENT_IDS
export type ExperimentId = valueof<typeof EXPERIMENT_IDS>

export interface ExperimentConfig {
	id: ExperimentId
	name: string
	description: string
	enabled: boolean
}

type valueof<X> = X[keyof X]

export const experimentConfigsMap: Record<ExperimentKey, ExperimentConfig> = {
	DIFF_STRATEGY: {
		id: EXPERIMENT_IDS.DIFF_STRATEGY,
		name: "Use experimental unified diff strategy",
		description:
			"Enable the experimental unified diff strategy. This strategy might reduce the number of retries caused by model errors but may cause unexpected behavior or incorrect edits. Only enable if you understand the risks and are willing to carefully review all changes.",
		enabled: false,
	},
	SEARCH_AND_REPLACE: {
		id: EXPERIMENT_IDS.SEARCH_AND_REPLACE,
		name: "Use experimental search and replace tool",
		description:
			"Enable the experimental search and replace tool, allowing Roo to replace multiple instances of a search term in one request.",
		enabled: false,
	},
	INSERT_BLOCK: {
		id: EXPERIMENT_IDS.INSERT_BLOCK,
		name: "Use experimental insert block tool",

		description:
			"Enable the experimental insert block tool, allowing Roo to insert multiple code blocks at once at specific line numbers without needing to create a diff.",
		enabled: false,
	},
}

export const experimentDefault = Object.fromEntries(
	Object.entries(experimentConfigsMap).map(([_, config]) => [config.id, config.enabled]),
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
	Object.values(experimentConfigsMap).map((config) => [config.id, config.name]),
) as Record<string, string>

export const experimentDescriptions = Object.fromEntries(
	Object.values(experimentConfigsMap).map((config) => [config.id, config.description]),
) as Record<string, string>
