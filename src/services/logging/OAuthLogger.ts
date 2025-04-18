import { Logger } from "@services/logging/Logger"

/**
 * Structured logging for OAuth operations
 * Provides consistent logs for authentication flows
 */
export class OAuthLogger {
	/**
	 * Logs an informational OAuth event
	 * @param serverName Name of the MCP server (or server hash if the name is not available)
	 * @param event A short identifier for the event (e.g., "auth_started", "token_acquired")
	 * @param details Optional structured data about the event
	 */
	static logInfo(serverName: string, event: string, details: Record<string, any> = {}): void {
		const detailsString = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : ""
		Logger.info(`OAuth [${serverName}] ${event}${detailsString}`)
	}

	/**
	 * Logs an error during an OAuth operation
	 * @param serverName Name of the MCP server (or server hash if the name is not available)
	 * @param event A short identifier for the event where the error occurred
	 * @param error Optional error message
	 * @param details Optional structured data about the event or error context
	 */
	static logError(serverName: string, event: string, error?: string, details: Record<string, any> = {}): void {
		const errorMsg = error ? ` - ${error}` : ""
		const detailsString = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : ""
		Logger.error(`OAuth [${serverName}] ${event}${errorMsg}${detailsString}`)
	}
}

/**
 * Masks sensitive parts of URLs to avoid logging credentials
 * @param url The URL to mask
 * @returns A URL with sensitive parts replaced by ***
 */
export function maskUrl(url: string): string {
	try {
		const parsedUrl = new URL(url)

		// Mask username and password if present
		if (parsedUrl.username || parsedUrl.password) {
			parsedUrl.username = parsedUrl.username ? "***" : ""
			parsedUrl.password = parsedUrl.password ? "***" : ""
		}

		// Mask sensitive query parameters based on common keywords in the key
		const searchParams = parsedUrl.searchParams
		const sensitiveKeywords = ["token", "secret", "password", "key", "apikey", "api_key", "client_secret", "code"]
		for (const [key] of searchParams.entries()) {
			const lowerKey = key.toLowerCase()
			if (sensitiveKeywords.some((keyword) => lowerKey.includes(keyword))) {
				searchParams.set(key, "***")
			}
		}

		return parsedUrl.toString()
	} catch (e) {
		// If URL parsing fails, return the original but warn in logs
		Logger.warn(`Failed to mask URL: ${e instanceof Error ? e.message : String(e)}`)
		return url
	}
}
