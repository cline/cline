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
 * Matches a leading `---` fenced YAML block. Group 1 is the YAML text, group 2
 * the remaining document body. Mirrors the SDK's rule/skill loader regex so both
 * sides agree on what counts as frontmatter.
 */
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

const UTF8_BOM = "\uFEFF"

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

	const match = normalizedMarkdown.match(FRONTMATTER_REGEX)

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
 * True when the frontmatter marks the document as disabled, with the same
 * precedence as the SDK loader: a boolean `disabled` wins, and the legacy
 * `enabled: false` only counts when `disabled` is absent.
 */
export function isFrontmatterDisabled(data: Record<string, unknown>): boolean {
	if (typeof data.disabled === "boolean") {
		return data.disabled
	}
	return data.enabled === false
}

/**
 * True when the document parses and its frontmatter puts it in the requested
 * state (`enabled` true means not disabled). Write paths check this on the
 * edited document before writing or reporting success, so a toggle never
 * claims a state the SDK will not load.
 */
export function hasRequestedEnabledState(content: string, enabled: boolean): boolean {
	const { data, parseError } = parseYamlFrontmatter(content)
	return !parseError && isFrontmatterDisabled(data) !== enabled
}

/** Matches a top-level `key:` line, with the key bare, double-quoted, or single-quoted. */
function isTopLevelKeyLine(line: string, key: string): boolean {
	return new RegExp(`^(?:${key}|"${key}"|'${key}')\\s*:`).test(line)
}

/** Matches a top-level `enabled: false` line in any boolean spelling YAML accepts (`false`, `False`, `FALSE`). */
function isEnabledFalseLine(line: string): boolean {
	return /^(?:enabled|"enabled"|'enabled')\s*:\s*(?:false|False|FALSE)\s*(#.*)?$/.test(line)
}

function parsesAsYaml(text: string): boolean {
	try {
		yaml.load(text, { schema: yaml.JSON_SCHEMA })
		return true
	} catch {
		return false
	}
}

/**
 * Number of lines the top-level entry starting at `index` spans.
 *
 * - An inline value that is complete on its own line (`disabled: true`) is one
 *   line, so an indented comment after it belongs to the author.
 * - An inline value that continues on later lines (a flow collection or a
 *   quoted string split across lines) spans up to the first line at which the
 *   entry parses.
 * - An empty value or a block scalar (`|`, `>`) takes its indented
 *   continuation lines (nested maps, lists, block text).
 */
function topLevelEntryLength(lines: ReadonlyArray<string>, index: number): number {
	const value = lines[index]
		.replace(/^[^:]*:/, "")
		.replace(/\s+#.*$/, "")
		.trim()
	if (value !== "" && !/^[|>]/.test(value)) {
		if (parsesAsYaml(lines[index])) {
			return 1
		}
		for (let end = index + 1; end < lines.length; end++) {
			if (parsesAsYaml(lines.slice(index, end + 1).join("\n"))) {
				return end - index + 1
			}
		}
		return 1
	}
	let length = 1
	while (index + length < lines.length && /^\s+\S/.test(lines[index + length])) {
		length++
	}
	return length
}

function removeTopLevelEntries(lines: ReadonlyArray<string>, shouldRemove: (line: string) => boolean): string[] {
	const result: string[] = []
	for (let index = 0; index < lines.length; ) {
		if (shouldRemove(lines[index])) {
			index += topLevelEntryLength(lines, index)
			continue
		}
		result.push(lines[index])
		index++
	}
	return result
}

/**
 * Update the `disabled` frontmatter flag shared by SDK-backed user
 * instructions (rules, skills, and workflows).
 *
 * The edit is line-based so a toggle never rewrites what the user authored:
 * YAML comments, key order, quoting, line endings, and a leading BOM all
 * survive. Only the top-level `disabled` key (and a stale `enabled: false`)
 * is touched; quoted keys (`"disabled":`) are recognized too.
 *
 * - enabled=false sets `disabled: true`, replacing an existing top-level
 *   `disabled` line or appending one to the block (creating the block if the
 *   document has none).
 * - enabled=true removes the top-level `disabled` line and any `enabled: false`
 *   line, dropping the fence entirely if nothing else remains.
 * - malformed frontmatter, or an edit that would produce malformed YAML, is
 *   left untouched so a toggle cannot corrupt the document.
 */
export function updateUserInstructionMarkdownDisabledState(content: string, enabled: boolean): string {
	const bom = content.startsWith(UTF8_BOM) ? UTF8_BOM : ""
	const text = bom ? content.slice(UTF8_BOM.length) : content
	const eol = text.includes("\r\n") ? "\r\n" : "\n"

	const { hadFrontmatter, parseError } = parseYamlFrontmatter(text)
	if (parseError) {
		return content
	}

	if (!hadFrontmatter) {
		if (enabled) {
			return content
		}
		return `${bom}---${eol}disabled: true${eol}---${eol}${text}`
	}

	const match = text.match(FRONTMATTER_REGEX)
	if (!match) {
		return content
	}
	const [, yamlBlock, body] = match
	const lines = yamlBlock.split(/\r?\n/)

	let nextLines: string[]
	if (enabled) {
		nextLines = removeTopLevelEntries(lines, (line) => isTopLevelKeyLine(line, "disabled") || isEnabledFalseLine(line))
	} else {
		const disabledIndex = lines.findIndex((line) => isTopLevelKeyLine(line, "disabled"))
		if (disabledIndex >= 0) {
			nextLines = [
				...lines.slice(0, disabledIndex),
				"disabled: true",
				...lines.slice(disabledIndex + topLevelEntryLength(lines, disabledIndex)),
			]
		} else {
			nextLines = [...lines, "disabled: true"]
		}
	}

	if (nextLines.every((line) => line.trim() === "")) {
		return `${bom}${body}`
	}

	const updated = `${bom}---${eol}${nextLines.join(eol)}${eol}---${eol}${body}`
	if (updated === content) {
		return content
	}
	// Never write YAML the loaders would then reject.
	const verification = parseYamlFrontmatter(updated)
	if (verification.parseError || !verification.hadFrontmatter) {
		return content
	}
	return updated
}
