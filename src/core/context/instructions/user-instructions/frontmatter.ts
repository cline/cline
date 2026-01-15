import * as yaml from "js-yaml"

export type FrontmatterParseResult = {
	data: Record<string, unknown>
	/**
	 * The markdown content after stripping the `--- frontmatter ---` block.
	 *
	 * Named `body` (rather than `content`) to make it clear this is the remaining
	 * document body and to keep this helper generic for multiple consumers.
	 */
	body: string

	/**
	 * True when the input contained a frontmatter block, even if parsing failed.
	 *
	 * This allows callers to distinguish:
	 * - "no frontmatter provided" (baseline behavior), vs
	 * - "frontmatter was provided" (may have semantic meaning in future consumers).
	 */
	hadFrontmatter: boolean
	/**
	 * Present only when YAML frontmatter was detected but failed to parse.
	 *
	 * This helper is intentionally fail-open and does not log. Returning `parseError`
	 * lets each caller decide whether to log, surface diagnostics, etc.
	 */
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
