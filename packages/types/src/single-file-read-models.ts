/**
 * Configuration for models that should use simplified single-file read_file tool
 * These models will use the simpler <read_file><path>...</path></read_file> format
 * instead of the more complex multi-file args format
 */

/**
 * Check if a model should use single file read format
 * @param modelId The model ID to check
 * @returns true if the model should use single file reads
 */
export function shouldUseSingleFileRead(modelId: string): boolean {
	return modelId.includes("grok-code-fast-1") || modelId.includes("code-supernova")
}
