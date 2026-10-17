/**
 * Sensitive-data sanitisation rules shared by the fetch-level VCR and the
 * session replay bundle redaction pass.
 *
 * Sanitisation is key-based: any JSON key whose name matches a rule gets
 * its value redacted. This is more robust than regex-matching values,
 * because it works regardless of the value format.
 *
 * Three categories of rules are applied:
 *
 * 1. Exact key names (case-insensitive): secrets, tokens, credentials.
 * 2. Key name patterns (suffix with a word boundary): catches ID fields, PII, etc.
 * 3. Value-level regex patterns: for values embedded in plain strings
 *    (e.g. filesystem paths, AWS key IDs in URLs).
 *
 * To add new sanitisation rules, add entries to the sets/arrays below. Both
 * consumers pick them up.
 */

export const SENSITIVE_DATA_REDACTED_VALUE = "REDACTED";

/** Keys whose values are always fully redacted (case-insensitive exact match). */
export const SENSITIVE_KEYS_EXACT: ReadonlySet<string> = new Set([
	// Secrets & tokens
	// Exact keys are compared after lowercasing, so accessToken matches accesstoken.
	"accesskeyid",
	"secretaccesskey",
	"idtoken",
	"refreshtoken",
	"accesstoken",
	"access_token",
	"refresh_token",
	"apikey",
	"api_key",
	"authorization",
	"password",
	"secret",
	"token",
	// PII
	"email",
	"displayname",
	"display_name",
	"userinfo",
]);

/**
 * Keys whose values are redacted if the key name ends with one of these
 * substrings at a word boundary (case-insensitive). Catches fields like
 * "userId", "organizationId", "memberId", "sessionId", etc.
 */
export const SENSITIVE_KEY_SUFFIXES: readonly string[] = [
	"id", // matches *Id and *_id, covering most entity identifiers
	"balance",
	"cost",
	"secret",
];

export interface SensitiveValuePattern {
	name: string;
	pattern: RegExp;
	replacement: string;
}

/** Regex patterns applied to plain string values (not key-based). */
export const SENSITIVE_VALUE_PATTERNS: readonly SensitiveValuePattern[] = [
	{
		name: "aws-access-key-id",
		pattern: /AKIA[A-Z0-9]{16}/g,
		replacement: "AKIA_REDACTED",
	},
	{
		name: "macos-home-path",
		pattern: /\/Users\/[A-Za-z0-9._-]+/g,
		replacement: "/Users/REDACTED_USER",
	},
	{
		name: "linux-home-path",
		pattern: /\/home\/[A-Za-z0-9._-]+/g,
		replacement: "/home/REDACTED_USER",
	},
];

export type SensitiveKeyRule = "key-exact" | "key-suffix";

/** Returns the key rule that matches `key`, or undefined when none does. */
export function matchSensitiveKey(key: string): SensitiveKeyRule | undefined {
	const lower = key.toLowerCase();
	if (SENSITIVE_KEYS_EXACT.has(lower)) {
		return "key-exact";
	}
	for (const suffix of SENSITIVE_KEY_SUFFIXES) {
		// Match "userId", "user_id", "id" but not "video" or "valid"
		if (lower === suffix) {
			return "key-suffix";
		}
		if (lower.endsWith(suffix) && lower.length > suffix.length) {
			const charBefore = lower[lower.length - suffix.length - 1];
			// Must be preceded by a word boundary character (_, -, or uppercase transition)
			if (charBefore === "_" || charBefore === "-") {
				return "key-suffix";
			}
			// camelCase: the suffix starts with lowercase but original key has uppercase
			const originalChar = key[key.length - suffix.length];
			if (
				originalChar &&
				originalChar === originalChar.toUpperCase() &&
				originalChar !== originalChar.toLowerCase()
			) {
				return "key-suffix";
			}
		}
	}
	return undefined;
}

/** Check whether a key name should have its value redacted. */
export function isSensitiveKey(key: string): boolean {
	return matchSensitiveKey(key) !== undefined;
}

/** Apply value-level regex sanitisation to a plain string. */
export function sanitizeSensitiveString(input: string): string {
	let result = input;
	for (const { pattern, replacement } of SENSITIVE_VALUE_PATTERNS) {
		result = result.replace(pattern, replacement);
	}
	return result;
}

/**
 * A single redaction made by {@link redactSensitiveData}. Never carries the
 * removed value.
 */
export interface SensitiveDataRedaction {
	/** JSON-path-like location, e.g. `metadata.auth.apiKey` or `items[2]`. */
	path: string;
	rule: SensitiveKeyRule | `value:${string}`;
}

export interface RedactSensitiveDataOptions {
	/** Called once per redaction. */
	onRedaction?: (redaction: SensitiveDataRedaction) => void;
	/** Base path prefixed to reported paths. */
	path?: string;
}

function joinPath(base: string, key: string | number): string {
	if (typeof key === "number") {
		return `${base}[${key}]`;
	}
	return base ? `${base}.${key}` : key;
}

function redactString(
	input: string,
	path: string,
	onRedaction: RedactSensitiveDataOptions["onRedaction"],
): string {
	let result = input;
	for (const { name, pattern, replacement } of SENSITIVE_VALUE_PATTERNS) {
		const next = result.replace(pattern, replacement);
		if (next !== result) {
			onRedaction?.({ path, rule: `value:${name}` });
			result = next;
		}
	}
	return result;
}

function redactValue(
	value: unknown,
	path: string,
	onRedaction: RedactSensitiveDataOptions["onRedaction"],
): unknown {
	if (value === null || value === undefined) {
		return value;
	}

	if (typeof value === "string") {
		// JSON-encoded strings are sanitised structurally, then re-encoded.
		try {
			const parsed = JSON.parse(value);
			if (typeof parsed === "object" && parsed !== null) {
				return JSON.stringify(redactValue(parsed, path, onRedaction));
			}
		} catch {
			// Not JSON, so apply string-level patterns.
		}
		return redactString(value, path, onRedaction);
	}

	if (Array.isArray(value)) {
		return value.map((item, index) =>
			redactValue(item, joinPath(path, index), onRedaction),
		);
	}

	if (typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(
			value as Record<string, unknown>,
		)) {
			const nestedPath = joinPath(path, key);
			const keyRule =
				typeof nested === "string" || typeof nested === "number"
					? matchSensitiveKey(key)
					: undefined;
			if (keyRule) {
				result[key] = SENSITIVE_DATA_REDACTED_VALUE;
				if (nested !== SENSITIVE_DATA_REDACTED_VALUE) {
					onRedaction?.({ path: nestedPath, rule: keyRule });
				}
			} else {
				result[key] = redactValue(nested, nestedPath, onRedaction);
			}
		}
		return result;
	}

	return value;
}

/**
 * Deep-sanitise a value, redacting sensitive keys and value patterns.
 * Handles objects, arrays, plain strings, and JSON-encoded strings. Only
 * string and number values under sensitive keys are replaced; nested
 * objects under a sensitive key are walked instead.
 */
export function redactSensitiveData<T>(
	value: T,
	options: RedactSensitiveDataOptions = {},
): T {
	return redactValue(value, options.path ?? "", options.onRedaction) as T;
}
