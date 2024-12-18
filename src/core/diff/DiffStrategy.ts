import type { DiffStrategy } from './types'
import { UnifiedDiffStrategy } from './strategies/unified'
import { SearchReplaceDiffStrategy } from './strategies/search-replace'
/**
 * Get the appropriate diff strategy for the given model
 * @param model The name of the model being used (e.g., 'gpt-4', 'claude-3-opus')
 * @returns The appropriate diff strategy for the model
 */
export function getDiffStrategy(model: string, fuzzyMatchThreshold?: number): DiffStrategy {
    // For now, return SearchReplaceDiffStrategy for all models
    // This architecture allows for future optimizations based on model capabilities
    return new SearchReplaceDiffStrategy(fuzzyMatchThreshold ?? 1.0)
}

export type { DiffStrategy }
export { UnifiedDiffStrategy, SearchReplaceDiffStrategy }
