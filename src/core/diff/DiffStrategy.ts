import type { DiffStrategy } from "./types"
import { SearchReplaceDiffStrategy } from "./strategies/search-replace"
import { NewUnifiedDiffStrategy } from "./strategies/new-unified"
import { MultiSearchReplaceDiffStrategy } from "./strategies/multi-search-replace"
import { EXPERIMENT_IDS, ExperimentId } from "../../shared/experiments"

export type { DiffStrategy }

/**
 * Get the appropriate diff strategy for the given model
 * @param model The name of the model being used (e.g., 'gpt-4', 'claude-3-opus')
 * @returns The appropriate diff strategy for the model
 */

export type DiffStrategyName = "unified" | "multi-search-and-replace" | "search-and-replace"

type GetDiffStrategyOptions = {
	model: string
	experiments: Partial<Record<ExperimentId, boolean>>
	fuzzyMatchThreshold?: number
}

export const getDiffStrategy = ({ fuzzyMatchThreshold, experiments }: GetDiffStrategyOptions): DiffStrategy =>
	experiments[EXPERIMENT_IDS.DIFF_STRATEGY_UNIFIED]
		? new NewUnifiedDiffStrategy(fuzzyMatchThreshold)
		: experiments[EXPERIMENT_IDS.DIFF_STRATEGY_MULTI_SEARCH_AND_REPLACE]
			? new MultiSearchReplaceDiffStrategy(fuzzyMatchThreshold)
			: new SearchReplaceDiffStrategy(fuzzyMatchThreshold)
