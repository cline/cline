import { jsonrepair } from "jsonrepair";

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

/** Parse strategies applied in order — first success wins. */
const strategies: Array<(text: string) => unknown> = [
	(text) => JSON.parse(text),
	(text) => JSON.parse(jsonrepair(text)),
	repairBareObjectValue,
];

export function parseJsonStream(input: unknown): unknown {
	if (typeof input !== "string") return input;

	const text = input.trimStart();
	if (text[0] !== "{" && text[0] !== "[") return input;

	for (const strategy of strategies) {
		try {
			const result = strategy(text);
			if (result !== undefined) return result;
		} catch {
			// strategy failed — try next
		}
	}
	return input;
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
