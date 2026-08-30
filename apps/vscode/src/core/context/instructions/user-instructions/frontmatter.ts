import { stripUtf8Bom } from "@cline/shared"
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
	// Strip a leading UTF-8 BOM (e.g. added by Windows Notepad's "UTF-8 with BOM" encoding),
	// which Node's `utf-8` decoding does not strip on its own. Without this the frontmatter
	// regex below never matches a file that starts with "\uFEFF---" (see cline/cline#12151).
	const normalizedMarkdown = stripUtf8Bom(markdown)

	const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
	const match = normalizedMarkdown.match(frontmatterRegex)

	if (!match) {
		return { data: {}, body: normalizedMarkdown, hadFrontmatter: false }
	}

	const [, yamlContent, body] = match
	try {
		const data = (yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>) || {}
		return { data, body, hadFrontmatter: true }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return { data: {}, body: normalizedMarkdown, hadFrontmatter: true, parseError: message }
	}
}

/**
 * Update the `disabled` frontmatter flag of a markdown document (skill, rule, ...).
 *
 * The SDK reads a document's enabled state from the frontmatter `disabled` field,
 * not from the extension's UI toggle state, so UI toggles must also write this
 * flag for the change to be reflected for the model. This mirrors the SDK's
 * updateSkillMarkdownEnabledState but lives in the extension and uses js-yaml
 * (the extension's frontmatter parser).
 *
 * - enabled=false → sets `disabled: true`.
 * - enabled=true  → removes `disabled` (and a stale `enabled: false`), dropping
 *   the frontmatter block entirely if it becomes empty.
 *
 * Returns the original content unchanged when enabling a document that has no
 * frontmatter (nothing to clear).
 */
export function updateMarkdownDisabledState(content: string, enabled: boolean): string {
	const { data, body, hadFrontmatter, parseError } = parseYamlFrontmatter(content)

	if (!hadFrontmatter && enabled) {
		return content
	}

	// parseYamlFrontmatter fails open on malformed YAML: it returns data={} and
	// body=<full original content> (frontmatter block included). Serializing here
	// would prepend a second `---` block and corrupt the file, so leave it
	// untouched and let the user fix the frontmatter.
	if (parseError) {
		return content
	}

	if (enabled) {
		delete data.disabled
		if (data.enabled === false) {
			delete data.enabled
		}
		if (Object.keys(data).length === 0) {
			return body
		}
		return serializeFrontmatter(data, body)
	}

	data.disabled = true
	return serializeFrontmatter(data, body)
}

function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
	const yamlText = yaml.dump(data, { schema: yaml.JSON_SCHEMA }).trimEnd()
	return `---\n${yamlText}\n---\n${body}`
}
