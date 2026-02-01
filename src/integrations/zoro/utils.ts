/**
 * Shared utilities for Zoro integration
 */

/**
 * Strips markdown code fence wrappers from JSON strings
 * Handles both ```json and ``` code fences
 */
export function stripMarkdownJson(text: string): string {
	const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
	if (jsonMatch) {
		return jsonMatch[1].trim()
	}

	const codeMatch = text.match(/```\s*([\s\S]*?)\s*```/)
	if (codeMatch) {
		return codeMatch[1].trim()
	}

	return text.trim()
}

/**
 * Constants for LLM iteration limits
 */
export const ITERATION_LIMITS = {
	VERIFICATION: 7,
	EXECUTION: 10,
	TEST_RESEARCH: 3,
	TEST_WRITE: 3,
	TEST_RUN: 1,
} as const
