import type { ModelInfo } from "../model.js"
import { anthropicModels } from "./anthropic.js"

// Claude Code
export type ClaudeCodeModelId = keyof typeof claudeCodeModels
export const claudeCodeDefaultModelId: ClaudeCodeModelId = "claude-sonnet-4-20250514"
export const CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS = 8000
export const claudeCodeModels = {
	"claude-sonnet-4-20250514": {
		...anthropicModels["claude-sonnet-4-20250514"],
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
