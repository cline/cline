export interface ExperimentConfig {
	id: string
	name: string
	description: string
	enabled: boolean
}

export const EXPERIMENT_IDS = {
	DIFF_STRATEGY: "experimentalDiffStrategy",
	SEARCH_AND_REPLACE: "search_and_replace",
	INSERT_BLOCK: "insert_code_block",
} as const

export type ExperimentId = keyof typeof EXPERIMENT_IDS

export const experimentConfigsMap: Record<ExperimentId, ExperimentConfig> = {
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
			"Enable the experimental Search and Replace tool. This tool allows Roo to search and replace term. Can be run multiple search and replace in sequence at once request.",
		enabled: false,
	},
	INSERT_BLOCK: {
		id: EXPERIMENT_IDS.INSERT_BLOCK,
		name: "Use experimental insert block tool",

		description:
			"Enable the experimental insert block tool. This tool allows Roo to insert code blocks into files. Can be insert multiple blocks at once.",
		enabled: false,
	},
}

// Keep the array version for backward compatibility
export const experimentConfigs = Object.values(experimentConfigsMap)
export const experimentDefault = Object.fromEntries(
	Object.entries(experimentConfigsMap).map(([_, config]) => [config.id, config.enabled]),
)

export const experiments = {
	get: (id: ExperimentId): ExperimentConfig | undefined => {
		return experimentConfigsMap[id]
	},
	isEnabled: (experimentsConfig: Record<string, boolean>, id: string): boolean => {
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
