import type { DiffStrategy } from './types'
import { UnifiedDiffStrategy } from './strategies/unified'
import { SearchReplaceDiffStrategy } from './strategies/search-replace'
/**
 * Get the appropriate diff strategy for the given model
 * @param model The name of the model being used (e.g., 'gpt-4', 'claude-3-opus')
 * @returns The appropriate diff strategy for the model
 */
export function getDiffStrategy(model: string, debugEnabled?: boolean): DiffStrategy {
    // For now, return SearchReplaceDiffStrategy for all models (with a fuzzy threshold of 0.9)
    // This architecture allows for future optimizations based on model capabilities
    return new SearchReplaceDiffStrategy(0.9, debugEnabled)
}

export type { DiffStrategy }
export { UnifiedDiffStrategy, SearchReplaceDiffStrategy }
