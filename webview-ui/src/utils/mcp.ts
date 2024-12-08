import { McpResource, McpResourceTemplate } from "../../../src/shared/mcp"

/**
 * Matches a URI against an array of URI templates and returns the matching template
 * @param uri The URI to match
 * @param templates Array of URI templates to match against
 * @returns The matching template or undefined if no match is found
 */
export function findMatchingTemplate(
	uri: string,
	templates: McpResourceTemplate[] = [],
): McpResourceTemplate | undefined {
	return templates.find((template) => {
		// Convert template to regex pattern
		const pattern = template.uriTemplate
			// Replace {param} with ([^/]+) to match any non-slash characters
			.replace(/\{([^}]+)\}/g, "([^/]+)")
			// Escape special regex characters except the ones we just added
			.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			// Un-escape the capturing groups we added
			.replace(/\\\(/g, "(")
			.replace(/\\\)/g, ")")

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
	if (exactMatch) return exactMatch

	// If no exact match, try to find a matching template
	return findMatchingTemplate(uri, templates)
}
