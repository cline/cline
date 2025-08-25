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
}
