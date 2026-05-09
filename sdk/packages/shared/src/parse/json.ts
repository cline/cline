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
