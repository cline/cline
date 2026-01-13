import * as yaml from "js-yaml"

export type FrontmatterParseResult = {
	data: Record<string, unknown>
	body: string
	hadFrontmatter: boolean
	/** Present only when YAML frontmatter was detected but failed to parse. */
	parseError?: string
}

/**
 * Parse YAML frontmatter from markdown content.
 *
 * Behavior is intentionally fail-open:
 * - If YAML fails to parse, returns data={} and body=original markdown.
 * - If no frontmatter exists, returns data={} and body=original markdown.
 */
export function parseYamlFrontmatter(markdown: string): FrontmatterParseResult {
	const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
	const match = markdown.match(frontmatterRegex)

	if (!match) {
		return { data: {}, body: markdown, hadFrontmatter: false }
	}

	const [, yamlContent, body] = match
	try {
		const data = (yaml.load(yamlContent) as Record<string, unknown>) || {}
		return { data, body, hadFrontmatter: true }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return { data: {}, body: markdown, hadFrontmatter: true, parseError: message }
	}
}
