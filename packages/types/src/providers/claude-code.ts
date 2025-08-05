import type { ModelInfo } from "../model.js"
import { anthropicModels } from "./anthropic.js"

// Regex pattern to match 8-digit date at the end of model names
const VERTEX_DATE_PATTERN = /-(\d{8})$/

/**
 * Converts Claude model names from hyphen-date format to Vertex AI's @-date format.
 *
 * @param modelName - The original model name (e.g., "claude-sonnet-4-20250514")
 * @returns The converted model name for Vertex AI (e.g., "claude-sonnet-4@20250514")
 *
 * @example
 * convertModelNameForVertex("claude-sonnet-4-20250514") // returns "claude-sonnet-4@20250514"
 * convertModelNameForVertex("claude-model") // returns "claude-model" (no change)
 */
export function convertModelNameForVertex(modelName: string): string {
	// Convert hyphen-date format to @date format for Vertex AI
	return modelName.replace(VERTEX_DATE_PATTERN, "@$1")
}

// Claude Code
export type ClaudeCodeModelId = keyof typeof claudeCodeModels
export const claudeCodeDefaultModelId: ClaudeCodeModelId = "claude-sonnet-4-20250514"
export const CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS = 16000

/**
 * Gets the appropriate model ID based on whether Vertex AI is being used.
 *
 * @param baseModelId - The base Claude Code model ID
 * @param useVertex - Whether to format the model ID for Vertex AI (default: false)
 * @returns The model ID, potentially formatted for Vertex AI
 *
 * @example
 * getClaudeCodeModelId("claude-sonnet-4-20250514", true) // returns "claude-sonnet-4@20250514"
 * getClaudeCodeModelId("claude-sonnet-4-20250514", false) // returns "claude-sonnet-4-20250514"
 */
export function getClaudeCodeModelId(baseModelId: ClaudeCodeModelId, useVertex = false): string {
	return useVertex ? convertModelNameForVertex(baseModelId) : baseModelId
}

export const claudeCodeModels = {
	"claude-sonnet-4-20250514": {
		...anthropicModels["claude-sonnet-4-20250514"],
		supportsImages: false,
		supportsPromptCache: true, // Claude Code does report cache tokens
		supportsReasoningEffort: false,
		supportsReasoningBudget: false,
		requiredReasoningBudget: false,
	},
	"claude-opus-4-1-20250805": {
		...anthropicModels["claude-opus-4-1-20250805"],
		supportsImages: false,
		supportsPromptCache: true, // Claude Code does report cache tokens
		supportsReasoningEffort: false,
		supportsReasoningBudget: false,
		requiredReasoningBudget: false,
	},
	"claude-opus-4-20250514": {
		...anthropicModels["claude-opus-4-20250514"],
		supportsImages: false,
		supportsPromptCache: true, // Claude Code does report cache tokens
		supportsReasoningEffort: false,
		supportsReasoningBudget: false,
		requiredReasoningBudget: false,
	},
	"claude-3-7-sonnet-20250219": {
		...anthropicModels["claude-3-7-sonnet-20250219"],
		supportsImages: false,
		supportsPromptCache: true, // Claude Code does report cache tokens
		supportsReasoningEffort: false,
		supportsReasoningBudget: false,
		requiredReasoningBudget: false,
	},
	"claude-3-5-sonnet-20241022": {
		...anthropicModels["claude-3-5-sonnet-20241022"],
		supportsImages: false,
		supportsPromptCache: true, // Claude Code does report cache tokens
		supportsReasoningEffort: false,
		supportsReasoningBudget: false,
		requiredReasoningBudget: false,
	},
	"claude-3-5-haiku-20241022": {
		...anthropicModels["claude-3-5-haiku-20241022"],
		supportsImages: false,
		supportsPromptCache: true, // Claude Code does report cache tokens
		supportsReasoningEffort: false,
		supportsReasoningBudget: false,
		requiredReasoningBudget: false,
	},
} as const satisfies Record<string, ModelInfo>
