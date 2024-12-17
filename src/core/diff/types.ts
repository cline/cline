/**
 * Interface for implementing different diff strategies
 */

export type DiffResult = 
  | { success: true; content: string }
  | { success: false; error: string; details?: { 
      similarity?: number;
      threshold?: number;
      matchedRange?: { start: number; end: number };
      searchContent?: string;
      bestMatch?: string;
    }};

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
     * @param startLine Optional line number where the search block starts. If not provided, searches the entire file.
     * @param endLine Optional line number where the search block ends. If not provided, searches the entire file.
     * @returns A DiffResult object containing either the successful result or error details
     */
    applyDiff(originalContent: string, diffContent: string, startLine?: number, endLine?: number): DiffResult
}
