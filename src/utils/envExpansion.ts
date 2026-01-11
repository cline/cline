/**
 * Utility for expanding environment variables in configuration values.
 * Supports ${env:VAR_NAME} syntax for referencing environment variables.
 */

/**
 * Expands environment variables in a string value.
 * Supports ${env:VAR_NAME} syntax.
 *
 * @param value - String that may contain variable references
 * @returns String with environment variables expanded
 *
 * @example
 * // If process.env.API_KEY = "secret123"
 * expandString("Bearer ${env:API_KEY}") // Returns: "Bearer secret123"
 * expandString("${env:MISSING}") // Returns: "${env:MISSING}" (unchanged)
 */
function expandString(value: string): string {
	return value.replace(/\$\{env:([^}]+)\}/g, (match, varName) => {
		// Trim whitespace from variable name to be forgiving of formatting
		const trimmedVarName = varName.trim()
		const envValue = process.env[trimmedVarName]

		if (envValue === undefined) {
			console.warn(`[MCP Config] Environment variable not found: ${trimmedVarName}`)
			return match // Leave unexpanded to show what's missing
		}

		// Empty string is a valid value, return it
		return envValue
	})
}

/**
 * Recursively expands environment variables in any value (string, object, array).
 * Only processes string values, leaving other types unchanged.
 *
 * @param value - Value to process (can be string, object, array, or primitive)
 * @returns Value with all environment variables expanded
 *
 * @example
 * expandEnvironmentVariables({
 *   api_key: "${env:API_KEY}",
 *   nested: {
 *     token: "${env:TOKEN}"
 *   }
 * })
 * // Returns object with all ${env:*} references expanded
 */
export function expandEnvironmentVariables<T>(value: T): T {
	// Handle string values
	if (typeof value === "string") {
		return expandString(value) as T
	}

	// Handle arrays
	if (Array.isArray(value)) {
		return value.map((item) => expandEnvironmentVariables(item)) as T
	}

	// Handle objects (but not null)
	if (value && typeof value === "object") {
		const result: any = {}
		for (const [key, val] of Object.entries(value)) {
			result[key] = expandEnvironmentVariables(val)
		}
		return result
	}

	// Return primitives unchanged (numbers, booleans, null, undefined)
	return value
}
