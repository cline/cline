import type { ModelInfo } from "../model.js"
import { anthropicModels } from "./anthropic.js"

// Claude Code
export type ClaudeCodeModelId = keyof typeof claudeCodeModels
export const claudeCodeDefaultModelId: ClaudeCodeModelId = "claude-sonnet-4-20250514"
export const claudeCodeModels = {
	"claude-sonnet-4-20250514": anthropicModels["claude-sonnet-4-20250514"],
	"claude-opus-4-20250514": anthropicModels["claude-opus-4-20250514"],
	"claude-3-7-sonnet-20250219": anthropicModels["claude-3-7-sonnet-20250219"],
	"claude-3-5-sonnet-20241022": anthropicModels["claude-3-5-sonnet-20241022"],
	"claude-3-5-haiku-20241022": anthropicModels["claude-3-5-haiku-20241022"],
} as const satisfies Record<string, ModelInfo>
