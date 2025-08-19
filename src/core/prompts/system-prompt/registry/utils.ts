import type { ApiHandlerModel } from "@/api"
import { ModelFamily } from "@/shared/prompts"
import {
	isClaude4ModelFamily,
	isGemini2dot5ModelFamily,
	isGPT5ModelFamily,
	isGrok4ModelFamily,
} from "../../system-prompt-legacy/utils"

/**
 * Check if a model ID represents a next-generation model
 */
function isNextGenModel(modelId: string): boolean {
	const mockApiHandlerModel: Pick<ApiHandlerModel, "id"> = { id: modelId }
	return (
		isClaude4ModelFamily(mockApiHandlerModel as ApiHandlerModel) ||
		isGemini2dot5ModelFamily(mockApiHandlerModel as ApiHandlerModel) ||
		isGrok4ModelFamily(mockApiHandlerModel as ApiHandlerModel) ||
		isGPT5ModelFamily(mockApiHandlerModel as ApiHandlerModel)
	)
}

/**
 * Extract model family from model ID (e.g., "claude-4" -> "claude")
 */
export function extractModelFamily(modelId: string): ModelFamily {
	// Check for next-gen models first
	if (isNextGenModel(modelId)) {
		return ModelFamily.NEXT_GEN
	}

	// // Handle common patterns
	// if (modelId.startsWith("claude")) {
	// 	return ModelFamily.CLAUDE;
	// }
	// if (modelId.startsWith("gpt")) {
	// 	return ModelFamily.GPT;
	// }
	// if (modelId.startsWith("gemini")) {
	// 	return ModelFamily.GEMINI;
	// }
	// if (modelId.startsWith("qwen")) {
	// 	return ModelFamily.QWEN;
	// }
	// if (modelId.includes("anthropic")) {
	// 	return ModelFamily.CLAUDE;
	// }
	// if (modelId.includes("openai")) {
	// 	return ModelFamily.GPT;
	// }
	// if (modelId.includes("google")) {
	// 	return ModelFamily.GEMINI;
	// }

	// Default fallback
	return ModelFamily.GENERIC
}
