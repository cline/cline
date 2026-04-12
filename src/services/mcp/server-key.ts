/**
 * Generate a deterministic, short key from an MCP server name.
 *
 * The key is used to build native tool-call names:
 *   `{key}0mcp0{tool_name}`
 *
 * Requirements:
 *  - Starts with a letter (Gemini rejects function names starting with digits)
 *  - 6 characters total (c + 5 alphanumeric) to stay under the 64-char tool-name limit
 *  - **Deterministic** — the same server name always produces the same key,
 *    even across extension restarts / reconnects (fixes #8087)
 *  - Low collision probability for typical numbers of MCP servers (< 100)
 */

/**
 * Produce a deterministic 5-character alphanumeric hash from a server name.
 * Uses djb2 which gives good distribution for short strings;
 * base-36 output (0-9a-z) is safe for function-name identifiers.
 */
export function hashServerName(name: string): string {
	let hash = 5381
	for (let i = 0; i < name.length; i++) {
		hash = (hash * 33) ^ name.charCodeAt(i)
	}
	// Convert to unsigned 32-bit, then to base-36 (0-9a-z), take first 5 chars
	return (hash >>> 0).toString(36).padStart(5, "0").slice(0, 5)
}

/**
 * Build the full 6-character server key: "c" prefix + 5-char hash.
 */
export function buildServerKey(serverName: string): string {
	return `c${hashServerName(serverName)}`
}
