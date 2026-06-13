import crypto from "crypto"

/**
 * Generates a unique hash for an MCP server based on its name and URL.
 * Used as the storage key in the legacy `mcpOAuthSecrets` blob; retained only
 * for the one-time migration of legacy tokens into the shared settings file
 * (see McpOAuthManager.migrateLegacySecrets).
 * @param serverName The name of the MCP server.
 * @param serverUrl The URL of the MCP server.
 * @returns A SHA-256 hash string.
 */
export const getServerAuthHash = (serverName: string, serverUrl: string): string => {
	return crypto.createHash("sha256").update(`${serverName}:${serverUrl}`).digest("hex")
}

