/**
 * Utility functions for tool validation and error checking
 */
export class ToolValidationUtils {
	/**
	 * Check if a result is a validation error
	 */
	static isValidationError(result: any): boolean {
		return (
			typeof result === "string" &&
			(result.includes("Missing required parameter") || result.includes("blocked by .clineignore"))
		)
	}

	/**
	 * Check if a tool result indicates an error condition
	 */
	static isToolError(result: any): boolean {
		return (
			typeof result === "string" &&
			(result.includes("Error") ||
				result.includes("Failed") ||
				result.includes("blocked by .clineignore") ||
				result.includes("Missing required parameter"))
		)
	}
}
