/**
 * Safely parse JSON with robust error handling and Unicode support
 * @param jsonString The JSON string to parse
 * @param defaultValue Optional default value to return if parsing fails
 * @returns Parsed JSON object or default value
 */
export function safeJsonParse<T = any>(
    jsonString: string | null | undefined, 
    defaultValue?: T
): T {
    // Handle null or undefined input
    if (jsonString == null) {
        if (defaultValue !== undefined) return defaultValue;
        throw new Error('JSON parse input is null or undefined');
    }

    try {
        // Normalize potential problematic Unicode characters
        const normalizedString = jsonString.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
        
        return JSON.parse(normalizedString);
    } catch (error) {
        // If a default value is provided, return it
        if (defaultValue !== undefined) return defaultValue;

        // Provide a detailed error message
        if (error instanceof SyntaxError) {
            throw new Error(`Invalid JSON: ${error.message}\nInput: ${jsonString}`);
        }

        throw error;
    }
}

/**
 * Safely stringify JSON with error handling
 * @param value The value to stringify
 * @param replacer Optional replacer function or array of keys to include
 * @param space Optional spacing
 * @returns Stringified JSON
 */
export function safeJsonStringify(
    value: any, 
    replacer?: ((this: any, key: string, value: any) => any) | (string | number)[] | null, 
    space?: string | number
): string {
    try {
        return JSON.stringify(value, replacer as any, space);
    } catch (error) {
        throw new Error(`JSON stringify failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
