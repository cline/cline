import type { DiffStrategy } from './types'
import { UnifiedDiffStrategy } from './strategies/unified'

/**
 * Get the appropriate diff strategy for the given model
 * @param model The name of the model being used (e.g., 'gpt-4', 'claude-3-opus')
 * @returns The appropriate diff strategy for the model
 */
export function getDiffStrategy(model: string): DiffStrategy {
    // For now, return UnifiedDiffStrategy for all models
    // This architecture allows for future optimizations based on model capabilities
    return new UnifiedDiffStrategy()
}

export type { DiffStrategy }
export { UnifiedDiffStrategy }
