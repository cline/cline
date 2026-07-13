import { printParseErrorCode, visit } from "jsonc-parser"

export class StrictJsonError extends Error {
	constructor(
		message: string,
		readonly code: "INVALID_UTF8" | "BOM" | "CRLF" | "DUPLICATE_KEY" | "INVALID_JSON" | "NON_CANONICAL",
	) {
		super(message)
		this.name = "StrictJsonError"
	}
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson)
	if (value !== null && typeof value === "object") {
		const source = value as Record<string, unknown>
		return Object.fromEntries(
			Object.keys(source)
				.sort()
				.map((key) => [key, sortJson(source[key])]),
		)
	}
	return value
}

export function canonicalJsonText(value: unknown): string {
	return `${JSON.stringify(sortJson(value))}\n`
}

export function canonicalJsonBytes(value: unknown): Buffer {
	return Buffer.from(canonicalJsonText(value), "utf8")
}

export function parseCanonicalJson(bytes: Uint8Array, label: string): unknown {
	let text: string
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
	} catch {
		throw new StrictJsonError(`${label} is not valid UTF-8`, "INVALID_UTF8")
	}
	if (text.startsWith("\uFEFF")) throw new StrictJsonError(`${label} must not contain a UTF-8 BOM`, "BOM")
	if (text.includes("\r")) throw new StrictJsonError(`${label} must use LF line endings`, "CRLF")

	const objectKeys: Set<string>[] = []
	let parseError: string | undefined
	let duplicateKey: string | undefined
	visit(
		text,
		{
			onObjectBegin: () => {
				objectKeys.push(new Set())
			},
			onObjectProperty: (property) => {
				const keys = objectKeys.at(-1)
				if (!keys) return
				if (keys.has(property)) duplicateKey = property
				keys.add(property)
			},
			onObjectEnd: () => {
				objectKeys.pop()
			},
			onError: (error) => {
				parseError ??= printParseErrorCode(error)
			},
		},
		{ allowTrailingComma: false, disallowComments: true },
	)
	if (duplicateKey) throw new StrictJsonError(`${label} contains duplicate key ${duplicateKey}`, "DUPLICATE_KEY")
	if (parseError) throw new StrictJsonError(`${label} is invalid JSON: ${parseError}`, "INVALID_JSON")

	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch (error) {
		throw new StrictJsonError(
			`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
			"INVALID_JSON",
		)
	}
	if (canonicalJsonText(parsed) !== text) {
		throw new StrictJsonError(`${label} is not canonical JSON`, "NON_CANONICAL")
	}
	return parsed
}
