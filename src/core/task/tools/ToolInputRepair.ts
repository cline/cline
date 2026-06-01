/**
 * Tool-input repair layer (validate-then-repair).
 *
 * Weaker / open models (e.g. DeepSeek) frequently emit tool inputs that are
 * *almost* right but trip strict validation, then can't recover. Rather than
 * counting these as mistakes, we repair the small, finite set of malformations
 * at the exact param the validator would reject.
 *
 * Principle: VALID INPUT IS NEVER TOUCHED. Every transform here is a guarded
 * no-op on well-formed input.
 *
 * Two deliberately separated domains:
 *  - Domain A: string/path unwrap on a param-name allowlist (XML string params).
 *  - Domain B: JSON-shape repair on the single JSON string param (MCP `arguments`).
 *
 * NOTE: AI-Hydro parses tool calls from XML tags, so every param is a string and
 * there is no native function-calling JSON envelope. Domain B therefore only
 * applies to the MCP `arguments` string — never to code-bearing params.
 */

export type RepairKind =
	| "markdown_autolink_unwrap"
	| "json_code_fence_strip"
	| "json_null_field_strip"
	| "json_stringified_array_parse"
	| "json_single_arg_unwrap"
	| "json_string_to_array"
	| "json_text_fix"

export interface RepairRecord {
	kind: RepairKind
	param?: string
}

// Domain A: params that name a path/identifier and may be wrapped by a model's
// chat-formatting prior. EXCLUDES code-bearing params (content, diff, text,
// command, regex) and the JSON `arguments` param.
const PATH_LIKE_PARAMS = new Set(["path", "uri", "url", "file_pattern", "server_name", "tool_name"])

// Common wrapper keys a model invents around the real argument object.
const SINGLE_ARG_WRAPPER_KEYS = new Set(["input", "args", "arguments", "params", "parameters"])

// Matches a value that is *entirely* a single markdown link: [label](url).
// Group 1 = label, group 2 = url without protocol.
const FULL_AUTOLINK_RE = /^\[([^\]]+)\]\((?:[a-z][a-z0-9+.-]*:\/\/)?([^)]+)\)$/i

const stripTrailingSlash = (s: string): string => s.replace(/\/+$/, "")

/**
 * Unwrap ONLY the degenerate auto-link case where the link text equals the URL
 * without its protocol — i.e. the model auto-linked a bare path:
 *   "[notes.md](http://notes.md)" -> "notes.md"
 * Real links like "[click](https://example.com)" (label != url) pass through.
 * Returns the unwrapped value, or undefined if nothing was repaired.
 */
export function unwrapMarkdownAutolink(value: string): string | undefined {
	const trimmed = value.trim()
	const m = FULL_AUTOLINK_RE.exec(trimmed)
	if (!m) {
		return undefined
	}
	const label = m[1].trim()
	const urlNoProto = m[2].trim()
	if (label.length === 0) {
		return undefined
	}
	if (stripTrailingSlash(label) !== stripTrailingSlash(urlNoProto)) {
		return undefined
	}
	return label
}

/**
 * Domain A. Returns a repaired COPY of params plus the list of repairs applied.
 * If nothing changed, returns the same object reference and an empty list.
 */
export function repairToolParams(params: Partial<Record<string, string>>): {
	params: Partial<Record<string, string>>
	repairs: RepairRecord[]
} {
	const repairs: RepairRecord[] = []
	let next: Partial<Record<string, string>> | undefined

	for (const key of Object.keys(params)) {
		if (!PATH_LIKE_PARAMS.has(key)) {
			continue
		}
		const value = params[key]
		if (typeof value !== "string") {
			continue
		}
		const unwrapped = unwrapMarkdownAutolink(value)
		if (unwrapped !== undefined && unwrapped !== value) {
			if (!next) {
				next = { ...params }
			}
			next[key] = unwrapped
			repairs.push({ kind: "markdown_autolink_unwrap", param: key })
		}
	}

	return { params: next ?? params, repairs }
}

// --- Domain B: MCP `arguments` JSON repair -------------------------------

interface JsonSchemaLike {
	properties?: Record<string, { type?: string | string[] }>
	required?: string[]
}

function expectsArray(schema: JsonSchemaLike | undefined, key: string): boolean {
	const t = schema?.properties?.[key]?.type
	return t === "array" || (Array.isArray(t) && t.includes("array"))
}

function isRequired(schema: JsonSchemaLike | undefined, key: string): boolean {
	return Array.isArray(schema?.required) && schema!.required!.includes(key)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v)
}

function stripCodeFence(raw: string): { value: string; stripped: boolean } {
	const trimmed = raw.trim()
	const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed)
	if (fence) {
		return { value: fence[1].trim(), stripped: true }
	}
	return { value: trimmed, stripped: false }
}

// Minimal, conservative textual fixes for not-quite-JSON. Only run AFTER a
// strict parse has already failed.
function applyTextFixes(s: string): string {
	return s
		.replace(/[“”]/g, '"') // smart double quotes
		.replace(/[‘’]/g, "'") // smart single quotes
		.replace(/,(\s*[}\]])/g, "$1") // trailing commas
}

function repairObjectShape(
	obj: Record<string, unknown>,
	schema: JsonSchemaLike | undefined,
	repairs: RepairRecord[],
): Record<string, unknown> {
	let working = obj

	// Single-arg unwrap: {"input": {...real args...}} -> {...real args...}
	const keys = Object.keys(working)
	if (keys.length === 1) {
		const k = keys[0]
		const inner = working[k]
		const knownProp = schema?.properties && k in schema.properties
		if (!knownProp && (SINGLE_ARG_WRAPPER_KEYS.has(k) || (schema?.properties && isPlainObject(inner)))) {
			if (isPlainObject(inner)) {
				working = inner
				repairs.push({ kind: "json_single_arg_unwrap", param: k })
			}
		}
	}

	const result: Record<string, unknown> = {}
	for (const key of Object.keys(working)) {
		let value = working[key]

		// Strip explicit nulls for non-required fields (model emitted null instead of omitting).
		if (value === null && !isRequired(schema, key)) {
			repairs.push({ kind: "json_null_field_strip", param: key })
			continue
		}

		// Parse a stringified array: "[\"a\",\"b\"]" -> ["a","b"].
		if (typeof value === "string" && /^\s*\[[\s\S]*\]\s*$/.test(value)) {
			try {
				const parsed = JSON.parse(value)
				if (Array.isArray(parsed)) {
					value = parsed
					repairs.push({ kind: "json_stringified_array_parse", param: key })
				}
			} catch {
				// leave as-is
			}
		}

		// Bare string where schema expects an array: "foo" -> ["foo"].
		if (typeof value === "string" && expectsArray(schema, key)) {
			value = [value]
			repairs.push({ kind: "json_string_to_array", param: key })
		}

		result[key] = value
	}

	return result
}

/**
 * Domain B. Repair the MCP `arguments` JSON string. Returns a string that the
 * caller feeds to JSON.parse. If the input is already valid JSON requiring no
 * shape fixes, the (re-serialized) value is equivalent. If unrepairable, returns
 * the original raw string so the caller's existing error path handles it.
 *
 * Ordering is deliberate: fence-strip -> parse -> object repairs. Text fixes run
 * only after a strict parse fails, and we re-parse at most once.
 */
export function repairMcpArgumentsString(raw: string, schema?: JsonSchemaLike): { value: string; repairs: RepairRecord[] } {
	const repairs: RepairRecord[] = []

	const fenced = stripCodeFence(raw)
	if (fenced.stripped) {
		repairs.push({ kind: "json_code_fence_strip" })
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(fenced.value)
	} catch {
		const fixed = applyTextFixes(fenced.value)
		try {
			parsed = JSON.parse(fixed)
			repairs.push({ kind: "json_text_fix" })
		} catch {
			return { value: raw, repairs: [] } // give up; let caller error
		}
	}

	if (!isPlainObject(parsed)) {
		// Arguments should be an object; nothing structural to repair safely.
		return { value: repairs.length ? JSON.stringify(parsed) : raw, repairs }
	}

	const repaired = repairObjectShape(parsed, schema, repairs)

	// Any recorded repair (fence strip, text fix, or object reshape) means the
	// raw string is no longer authoritative — return the reserialized value.
	return { value: repairs.length ? JSON.stringify(repaired) : raw, repairs }
}
