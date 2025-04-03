import type { DiffStrategy } from "./types"
import { MultiSearchReplaceDiffStrategy } from "./strategies/multi-search-replace"
import { ExperimentId } from "../../shared/experiments"

export type { DiffStrategy }

/**
 * Get the appropriate diff strategy for the given model
 * @param model The name of the model being used (e.g., 'gpt-4', 'claude-3-opus')
 * @returns The appropriate diff strategy for the model
 */

export type DiffStrategyName = "multi-search-and-replace"

type GetDiffStrategyOptions = {
	model: string
	experiments: Partial<Record<ExperimentId, boolean>>
	fuzzyMatchThreshold?: number
}

export const getDiffStrategy = ({ fuzzyMatchThreshold, experiments }: GetDiffStrategyOptions): DiffStrategy =>
	new MultiSearchReplaceDiffStrategy(fuzzyMatchThreshold)
