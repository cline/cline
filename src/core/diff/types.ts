/**
 * Interface for implementing different diff strategies
 */
export interface DiffStrategy {
    /**
     * Get the tool description for this diff strategy
     * @param cwd The current working directory
     * @returns The complete tool description including format requirements and examples
     */
    getToolDescription(cwd: string): string

    /**
     * Apply a diff to the original content
     * @param originalContent The original file content
     * @param diffContent The diff content in the strategy's format
     * @returns The new content after applying the diff, or false if the diff could not be applied
     */
    applyDiff(originalContent: string, diffContent: string): string | false
}
