import { McpMarketplaceCatalog, McpResource, McpResourceTemplate } from "@shared/mcp"

/**
 * Matches a URI against an array of URI templates and returns the matching template
 * @param uri The URI to match
 * @param templates Array of URI templates to match against
 * @returns The matching template or undefined if no match is found
 */
export function findMatchingTemplate(uri: string, templates: McpResourceTemplate[] = []): McpResourceTemplate | undefined {
	return templates.find((template) => {
		// Convert template to regex pattern
		const pattern = String(template.uriTemplate)
			// First escape special regex characters
			.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			// Then replace {param} with ([^/]+) to match any non-slash characters
			// We need to use \{ and \} because we just escaped them
			.replace(/\\\{([^}]+)\\\}/g, "([^/]+)")

		const regex = new RegExp(`^${pattern}$`)
		return regex.test(uri)
	})
}

/**
 * Finds either an exact resource match or a matching template for a given URI
 * @param uri The URI to find a match for
 * @param resources Array of concrete resources
 * @param templates Array of resource templates
 * @returns The matching resource, template, or undefined
 */
export function findMatchingResourceOrTemplate(
	uri: string,
	resources: McpResource[] = [],
	templates: McpResourceTemplate[] = [],
): McpResource | McpResourceTemplate | undefined {
	// First try to find an exact resource match
	const exactMatch = resources.find((resource) => resource.uri === uri)
	if (exactMatch) {
		return exactMatch
	}

	// If no exact match, try to find a matching template
	return findMatchingTemplate(uri, templates)
}

/**
 * Attempts to convert an MCP server name to its display name using the marketplace catalog
 * @param serverName The server name/ID to look up
 * @param mcpMarketplaceCatalog The marketplace catalog containing server metadata
 * @returns The display name if found in catalog, otherwise returns the original server name
 */
export function getMcpServerDisplayName(serverName: string, mcpMarketplaceCatalog: McpMarketplaceCatalog): string {
	// Find matching item in marketplace catalog
	const catalogItem = mcpMarketplaceCatalog.items.find((item) => item.mcpId === serverName)

	// Return display name if found, otherwise return original server name
	return catalogItem?.name || serverName
}
