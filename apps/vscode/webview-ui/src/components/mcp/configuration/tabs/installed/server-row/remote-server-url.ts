function getMcpEndpointIdentity(value: string | null | undefined): string | undefined {
	if (!value) {
		return undefined
	}
	try {
		const url = new URL(value)
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return undefined
		}
		return `${url.origin}${url.pathname}`
	} catch {
		return undefined
	}
}

/**
 * Query strings and hashes are stripped from MCP URLs before they cross the
 * webview boundary. Match enterprise policy entries on the non-secret endpoint
 * identity so managed-server controls remain enforced for parameterized URLs.
 */
export function mcpEndpointUrlsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
	const leftIdentity = getMcpEndpointIdentity(left)
	return leftIdentity !== undefined && leftIdentity === getMcpEndpointIdentity(right)
}
