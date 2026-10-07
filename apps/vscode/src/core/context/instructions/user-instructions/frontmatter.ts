import { isDeepStrictEqual } from "node:util"
import { stripUtf8Bom } from "@cline/shared"
import * as yaml from "js-yaml"
import { type Document, isMap, isScalar, parseDocument } from "yaml"

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

const ENABLEMENT_KEYS = ["disabled", "enabled"] as const

type SourceRange = [number, number, number]

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/**
 * Parse a frontmatter block with the SDK loader's YAML parser. Returns
 * `undefined` for anything the SDK would reject: invalid YAML, duplicate keys,
 * a non-mapping document, or a non-boolean `disabled`/`enabled`.
 */
function parseSdkFrontmatterBlock(block: string): { document: Document.Parsed; data: Record<string, unknown> } | undefined {
	const document = parseDocument(block)
	if (document.errors.length > 0 || (document.contents !== null && !isMap(document.contents))) {
		return undefined
	}
	const data = asRecord(document.toJS())
	for (const key of ENABLEMENT_KEYS) {
		if (data[key] !== undefined && data[key] !== null && typeof data[key] !== "boolean") {
			return undefined
		}
	}
	return { document, data }
}

/**
 * Whether the SDK loader would treat this document as enabled, or `undefined`
 * when it would reject the frontmatter altogether.
 */
export function readSdkEnabledState(content: string): boolean | undefined {
	const match = stripUtf8Bom(content).match(FRONTMATTER_REGEX)
	if (!match) {
		return true
	}
	const parsed = parseSdkFrontmatterBlock(match[1])
	return parsed ? !isFrontmatterDisabled(parsed.data) : undefined
}

/**
 * True when the SDK loader would load the document in the requested state.
 * Write paths check this on the edited document before writing or reporting
 * success, so a toggle never claims a state the SDK will not load.
 */
export function hasRequestedEnabledState(content: string, enabled: boolean): boolean {
	return readSdkEnabledState(content) === enabled
}

/**
 * Update the `disabled` frontmatter flag shared by SDK-backed user
 * instructions (rules, skills, and workflows).
 *
 * The frontmatter is parsed with the SDK loader's YAML parser and edited by
 * source range, so only the characters of the top-level `disabled` or
 * `enabled` entries change. Everything else the author wrote, including other
 * values, comments, key order, quoting, line endings, and a UTF-8 BOM, stays
 * byte for byte.
 *
 * - Disabling sets an existing `disabled` value to `true`, or appends a
 *   `disabled: true` entry (creating the frontmatter if there is none).
 * - Enabling removes the `disabled` entry and a legacy `enabled: false`; an
 *   entry that carries a comment keeps its line and has its value set to
 *   `false` (or `true` for `enabled`) instead, so the comment survives.
 *   Frontmatter left empty is removed entirely.
 * - A document the SDK would reject, or an edit whose result would change any
 *   other value or not reach the requested state, is returned unchanged.
 */
export function updateUserInstructionMarkdownDisabledState(content: string, enabled: boolean): string {
	const bom = content.startsWith(UTF8_BOM) ? UTF8_BOM : ""
	const text = bom ? content.slice(UTF8_BOM.length) : content
	const eol = text.includes("\r\n") ? "\r\n" : "\n"

	const match = text.match(FRONTMATTER_REGEX)
	if (!match) {
		return enabled ? content : `${bom}---${eol}disabled: true${eol}---${eol}${text}`
	}
	const [, block, body] = match
	const blockStart = text.indexOf("\n") + 1

	const parsed = parseSdkFrontmatterBlock(block)
	if (!parsed) {
		return content
	}
	const before = parsed.data
	if (isFrontmatterDisabled(before) !== enabled) {
		return content
	}

	const pairs = isMap(parsed.document.contents) ? parsed.document.contents.items : []
	const rangesFor = (key: string): { key: SourceRange; value: SourceRange } | undefined => {
		const pair = pairs.find((item) => isScalar(item.key) && item.key.value === key)
		const keyRange = (pair?.key as { range?: SourceRange } | undefined)?.range
		const valueRange = (pair?.value as { range?: SourceRange } | null | undefined)?.range
		return keyRange && valueRange ? { key: keyRange, value: valueRange } : undefined
	}

	const edits: Array<{ start: number; end: number; text: string }> = []
	const setValue = (key: string, value: string): boolean => {
		const ranges = rangesFor(key)
		if (!ranges) {
			return false
		}
		edits.push({ start: ranges.value[0], end: ranges.value[1], text: value })
		return true
	}
	const removeEntry = (key: string, fallbackValue: string): boolean => {
		const ranges = rangesFor(key)
		if (!ranges) {
			return false
		}
		const start = ranges.key[0]
		const end = ranges.value[2]
		const startsLine = start === 0 || block[start - 1] === "\n"
		if (!startsLine || block.slice(start, end).includes("#")) {
			return setValue(key, fallbackValue)
		}
		edits.push({ start, end, text: "" })
		return true
	}

	if (enabled) {
		if (rangesFor("disabled") && before.disabled !== false && !removeEntry("disabled", "false")) {
			return content
		}
		if (before.enabled === false && !removeEntry("enabled", "true")) {
			return content
		}
	} else if (rangesFor("disabled")) {
		if (!setValue("disabled", "true")) {
			return content
		}
	} else {
		edits.push({ start: block.length, end: block.length, text: `${block.length > 0 ? eol : ""}disabled: true` })
	}

	let nextBlock = block
	for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
		nextBlock = nextBlock.slice(0, edit.start) + edit.text + nextBlock.slice(edit.end)
	}
	// Removing the last entry leaves the newline that ended the entry before it.
	if (!/\r?\n$/.test(block)) {
		nextBlock = nextBlock.replace(/\r?\n$/, "")
	}
	if (nextBlock.trim() === "") {
		return `${bom}${body}`
	}

	const after = parseSdkFrontmatterBlock(nextBlock)
	if (!after || isFrontmatterDisabled(after.data) === enabled) {
		return content
	}
	for (const key of new Set([...Object.keys(before), ...Object.keys(after.data)])) {
		if (!(ENABLEMENT_KEYS as readonly string[]).includes(key) && !isDeepStrictEqual(before[key], after.data[key])) {
			return content
		}
	}
	return `${bom}${text.slice(0, blockStart)}${nextBlock}${text.slice(blockStart + block.length)}`
}
