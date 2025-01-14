import type { DiffStrategy } from './types'
import { UnifiedDiffStrategy } from './strategies/unified'
import { SearchReplaceDiffStrategy } from './strategies/search-replace'
import { NewUnifiedDiffStrategy } from './strategies/new-unified'
/**
 * Get the appropriate diff strategy for the given model
 * @param model The name of the model being used (e.g., 'gpt-4', 'claude-3-opus')
 * @returns The appropriate diff strategy for the model
 */
export function getDiffStrategy(model: string, fuzzyMatchThreshold?: number, experimentalDiffStrategy?: boolean): DiffStrategy {
    if (experimentalDiffStrategy) {
        // Use the fuzzyMatchThreshold with a minimum of 0.8 (80%)
        const threshold = Math.max(fuzzyMatchThreshold ?? 1.0, 0.8)
        return new NewUnifiedDiffStrategy(threshold)
    }
    // Default to the stable SearchReplaceDiffStrategy
    return new SearchReplaceDiffStrategy()
}

export type { DiffStrategy }
export { UnifiedDiffStrategy, SearchReplaceDiffStrategy }
