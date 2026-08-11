import { jsonrepair } from "jsonrepair";

/**
 * Returns true when the text contains an unterminated string value,
 * meaning repair would close it with a synthetic quote and produce a
 * plausible but incorrect value. This guards against truncated tool-call
 * arguments being silently repaired into valid-looking JSON whose values
 * are cut off mid-content.
 *
 * Tracks both double-quoted and single-quoted strings so literal quotes
 * inside the opposite delimiter style do not trigger false positives
 * (e.g. a bare-object value like `{"commands": grep -c " file.txt}` or
 * a single-quoted payload like `{'commands': ['grep " foo']}`).
 */
function hasUnterminatedString(text: string): boolean {
	let inDouble = false;
	let inSingle = false;
	let escapeNext = false;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (escapeNext) {
			escapeNext = false;
			continue;
		}
		if (ch === "\\") {
			escapeNext = true;
			continue;
		}
		if (!inSingle && ch === '"') {
			inDouble = !inDouble;
		} else if (!inDouble && ch === "'") {
			inSingle = !inSingle;
		}
	}
	return inDouble || inSingle;
}

const BARE_OBJECT_RE = /^\{\s*"([A-Za-z0-9_.$-]+)"\s*:\s*([\s\S]+?)\s*\}$/;
/**
 * Attempt to repair `{"key": some unquoted value}` by wrapping the value in quotes.
 * Returns undefined when the input doesn't match or the value is already a JSON token.
 */
function repairBareObjectValue(
	text: string,
): Record<string, string> | undefined {
	const match = text.match(BARE_OBJECT_RE);
	if (!match) return undefined;

	const [, key, rawValue] = match;
	const value = rawValue.trim();
	if (!value) return undefined;

	// Skip values that are already valid JSON tokens
	const ch = value[0];
	if (
		ch === '"' ||
		ch === "{" ||
		ch === "[" ||
		value === "true" ||
		value === "false" ||
		value === "null" ||
		Number.isFinite(Number(value))
	) {
		return undefined;
	}

	return JSON.parse(`{"${key}":${JSON.stringify(value)}}`);
}

export function parseJsonStream(input: unknown): unknown {
	if (typeof input !== "string") return input;

	const text = input.trimStart();
	if (text[0] !== "{" && text[0] !== "[") return input;

	// Always attempt a straight parse first — this is the common path.
	try {
		return JSON.parse(text);
	} catch {
		// Not valid JSON — attempt repair below.
	}

	// If the text has an unterminated string literal the content was almost
	// certainly cut off mid-value (e.g. the model hit max_tokens while
	// writing a file-contents argument). Repairing this with jsonrepair
	// would close the string with a synthetic quote and produce a
	// valid-looking but wrong value. Skip jsonrepair so the error
	// propagates naturally. jsonrepair stays ahead of bare-object repair
	// because both can handle bare non-string tokens (True, None) and only
	// jsonrepair maps them to their typed JSON equivalents.
	if (!hasUnterminatedString(text)) {
		try {
			return JSON.parse(jsonrepair(text));
		} catch {
			// jsonrepair failed — try bare-object repair below.
		}
	}

	// Last resort: wraps the value verbatim through JSON.stringify and
	// cannot invent a string terminator, so it needs no truncation guard.
	return repairBareObjectValue(text) ?? input;
}

export function safeJsonStringify(input: unknown): string {
	const seen = new WeakSet<object>();

	try {
		const result = JSON.stringify(input, (_key, value) => {
			if (typeof value === "bigint") return value.toString();

			if (value && typeof value === "object") {
				if (seen.has(value as object)) return "[Circular]";
				seen.add(value as object);
			}

			return value;
		});

		return result ?? "null";
	} catch {
		return String(input);
	}
}

export function safeJsonParse<T>(raw: string): T | undefined {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaTypes(schema: Record<string, unknown>): string[] {
	const type = schema.type;
	if (typeof type === "string") {
		return [type];
	}
	return Array.isArray(type)
		? type.filter((item): item is string => typeof item === "string")
		: [];
}

function schemaAcceptsKind(
	schema: Record<string, unknown>,
	kind: "array" | "object",
): boolean {
	const types = schemaTypes(schema);
	if (types.includes(kind)) {
		return true;
	}

	for (const key of ["anyOf", "oneOf", "allOf"] as const) {
		const branches = schema[key];
		if (
			Array.isArray(branches) &&
			branches.some(
				(branch) => isRecord(branch) && schemaAcceptsKind(branch, kind),
			)
		) {
			return true;
		}
	}

	return false;
}

function parseJsonStringForSchema(
	value: unknown,
	schema: Record<string, unknown>,
) {
	if (typeof value !== "string") {
		return value;
	}

	const trimmed = value.trim();
	const expectsArray = schemaAcceptsKind(schema, "array");
	const expectsObject = schemaAcceptsKind(schema, "object");
	if (
		(!expectsArray || !trimmed.startsWith("[")) &&
		(!expectsObject || !trimmed.startsWith("{"))
	) {
		return value;
	}

	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (Array.isArray(parsed)) {
			return expectsArray ? parsed : value;
		}
		if (isRecord(parsed)) {
			return expectsObject ? parsed : value;
		}
		return value;
	} catch {
		return value;
	}
}

export function normalizeJsonLikeStringsForSchema(
	input: unknown,
	schema: Record<string, unknown>,
): unknown {
	const value = parseJsonStringForSchema(input, schema);

	if (Array.isArray(value)) {
		const items = schema.items;
		if (!isRecord(items)) {
			return value;
		}
		let changed = false;
		const normalized = value.map((item) => {
			const next = normalizeJsonLikeStringsForSchema(item, items);
			changed ||= next !== item;
			return next;
		});
		return changed ? normalized : value;
	}

	if (!isRecord(value)) {
		return value;
	}

	const properties = schema.properties;
	if (!isRecord(properties)) {
		return value;
	}

	let changed = false;
	const normalized: Record<string, unknown> = { ...value };
	for (const [key, propertySchema] of Object.entries(properties)) {
		if (!(key in value) || !isRecord(propertySchema)) {
			continue;
		}
		const next = normalizeJsonLikeStringsForSchema(value[key], propertySchema);
		if (next !== value[key]) {
			normalized[key] = next;
			changed = true;
		}
	}

	return changed ? normalized : value;
}
