import { isDeepStrictEqual } from "node:util"
import { parseRuleConfigFromMarkdown, parseSkillConfigFromMarkdown } from "@cline/core"
import { stripUtf8Bom } from "@cline/shared"
import * as yaml from "js-yaml"
import { isMap, isScalar, parseDocument } from "yaml"

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
 * `enabled: false` only counts when `disabled` is absent. Used by the legacy
 * rule loader; the SDK-facing paths below ask the SDK parser instead.
 */
export function isFrontmatterDisabled(data: Record<string, unknown>): boolean {
	if (typeof data.disabled === "boolean") {
		return data.disabled
	}
	return data.enabled === false
}

export type UserInstructionKind = "rule" | "skill"

const ENABLEMENT_KEYS: ReadonlyArray<string> = ["disabled", "enabled"]

type SourceRange = [number, number, number]

/**
 * Whether the SDK would load this document as enabled (`true`), as disabled
 * (`false`), or not at all (`undefined`: frontmatter it cannot parse, a
 * non-boolean flag, or an empty body).
 *
 * This is the SDK's own parser, not a reimplementation of its rules, so the
 * Rules panel, the write paths, and the editor below can never disagree with
 * what the SDK loads.
 */
export function readSdkEnabledState(content: string, kind: UserInstructionKind = "rule"): boolean | undefined {
	try {
		const config =
			kind === "skill" ? parseSkillConfigFromMarkdown(content, "skill") : parseRuleConfigFromMarkdown(content, "rule")
		return config.disabled !== true
	} catch {
		return undefined
	}
}

/**
 * True when the SDK would load the document in the requested state. Write
 * paths check this on the edited document before writing or reporting
 * success, so a toggle never claims a state the SDK will not load.
 */
export function hasRequestedEnabledState(content: string, enabled: boolean, kind: UserInstructionKind = "rule"): boolean {
	return readSdkEnabledState(content, kind) === enabled
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The top-level values other than the enablement flags, as the SDK reads them. */
function otherFrontmatterValues(content: string, kind: UserInstructionKind): Record<string, unknown> | undefined {
	try {
		const config =
			kind === "skill" ? parseSkillConfigFromMarkdown(content, "skill") : parseRuleConfigFromMarkdown(content, "rule")
		const values = { ...asRecord(config.frontmatter) }
		for (const key of ENABLEMENT_KEYS) {
			delete values[key]
		}
		return values
	} catch {
		return undefined
	}
}

/**
 * Update the `disabled` frontmatter flag shared by SDK-backed user
 * instructions (rules and skills).
 *
 * The SDK's parser decides every state question (see readSdkEnabledState).
 * The frontmatter is then parsed as a YAML document only to find the source
 * ranges of the top-level `disabled` and `enabled` entries, and just those
 * characters change. Everything else the author wrote, including other
 * values, comments, key order, quoting, line endings, and a UTF-8 BOM, stays
 * byte for byte.
 *
 * - Disabling sets an existing `disabled` value to `true`, or appends a
 *   `disabled: true` entry. A document with no frontmatter, or with
 *   frontmatter that is not a mapping (which the SDK loads as having no
 *   metadata), gets a new `disabled: true` block above its existing text.
 * - Enabling removes the `disabled` entry and a legacy `enabled: false`; an
 *   entry that carries a comment keeps its line and has its value set to
 *   `false` (or `true` for `enabled`) instead, so the comment survives.
 *   Frontmatter left empty is removed entirely.
 * - A document the SDK does not load, or an edit whose result the SDK would
 *   not load in the requested state or that would change any other value,
 *   is returned unchanged.
 */
export function updateUserInstructionMarkdownDisabledState(
	content: string,
	enabled: boolean,
	kind: UserInstructionKind = "rule",
): string {
	const bom = content.startsWith(UTF8_BOM) ? UTF8_BOM : ""
	const text = bom ? content.slice(UTF8_BOM.length) : content
	const eol = text.includes("\r\n") ? "\r\n" : "\n"

	// Nothing to do for a document the SDK does not load, or one already in
	// the requested state.
	const currentState = readSdkEnabledState(text, kind)
	if (currentState === undefined || currentState === enabled) {
		return content
	}
	const prependDisabledBlock = () => `${bom}---${eol}disabled: true${eol}---${eol}${text}`

	const match = text.match(FRONTMATTER_REGEX)
	if (!match) {
		return enabled ? content : prependDisabledBlock()
	}
	const [, block, body] = match
	const blockStart = text.indexOf("\n") + 1

	const document = parseDocument(block)
	if (document.errors.length > 0) {
		return content
	}
	// An empty block (whitespace or comments only) is a mapping with no
	// entries; the flag is appended inside it so the comments stay in place.
	if (document.contents !== null && !isMap(document.contents)) {
		// The SDK treats non-mapping frontmatter as no metadata, so the rule is
		// enabled and nothing in the block can be edited to disable it.
		return enabled ? content : prependDisabledBlock()
	}
	const before = otherFrontmatterValues(text, kind)
	if (!before) {
		return content
	}

	const pairs = isMap(document.contents) ? document.contents.items : []
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

	const flags = asRecord(document.toJS())
	if (enabled) {
		if (rangesFor("disabled") && flags.disabled !== false && !removeEntry("disabled", "false")) {
			return content
		}
		if (flags.enabled === false && !removeEntry("enabled", "true")) {
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
	const nextText =
		nextBlock.trim() === "" ? body : `${text.slice(0, blockStart)}${nextBlock}${text.slice(blockStart + block.length)}`
	if (readSdkEnabledState(nextText, kind) !== enabled || !isDeepStrictEqual(before, otherFrontmatterValues(nextText, kind))) {
		return content
	}
	return `${bom}${nextText}`
}
