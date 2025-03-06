import type { DiffStrategy } from "./types"
import { UnifiedDiffStrategy } from "./strategies/unified"
import { SearchReplaceDiffStrategy } from "./strategies/search-replace"
import { NewUnifiedDiffStrategy } from "./strategies/new-unified"
import { MultiSearchReplaceDiffStrategy } from "./strategies/multi-search-replace"
/**
 * Get the appropriate diff strategy for the given model
 * @param model The name of the model being used (e.g., 'gpt-4', 'claude-3-opus')
 * @returns The appropriate diff strategy for the model
 */
export function getDiffStrategy(
	model: string,
	fuzzyMatchThreshold?: number,
	experimentalDiffStrategy: boolean = false,
	multiSearchReplaceDiffStrategy: boolean = false,
): DiffStrategy {
	if (experimentalDiffStrategy) {
		return new NewUnifiedDiffStrategy(fuzzyMatchThreshold)
	}

	if (multiSearchReplaceDiffStrategy) {
		return new MultiSearchReplaceDiffStrategy(fuzzyMatchThreshold)
	} else {
		return new SearchReplaceDiffStrategy(fuzzyMatchThreshold)
	}
}

export type { DiffStrategy }
export { UnifiedDiffStrategy, SearchReplaceDiffStrategy }
