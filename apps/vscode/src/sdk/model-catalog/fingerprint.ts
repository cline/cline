import { createHash } from "node:crypto"
import type { EffectiveProviderConfig, Fingerprint, ProviderId } from "./contracts"

const FINGERPRINT_VERSION = 1
const SECRET_HASH_LENGTH = 12

function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex")
}

/**
 * Hash a secret-bearing string into a short, opaque digest. The raw value
 * never appears in the returned record, so the sanitized payload can be
 * safely retained or serialized internally without leaking secrets.
 *
 * Empty/undefined values map to `{present: false}` so absence is
 * distinguishable from presence-with-empty-hash.
 */
function shortSecretHash(value: string | undefined): { readonly present: boolean; readonly hash?: string } {
	if (typeof value !== "string" || value.length === 0) {
		return { present: false }
	}

	return { present: true, hash: sha256Hex(value).slice(0, SECRET_HASH_LENGTH) }
}

/**
 * Sanitize a header map: header *names* are not secret and stay readable
 * (they are useful for debugging fingerprint differences), but header
 * *values* often carry tokens and must be hashed before reaching the
 * canonical payload. Returns `null` when no headers are present so the
 * fingerprint distinguishes "no headers" from "empty headers map".
 */
function sanitizeHeaders(
	headers: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, { readonly present: boolean; readonly hash?: string }>> | null {
	if (!headers) {
		return null
	}

	const sanitized: Record<string, { readonly present: boolean; readonly hash?: string }> = {}
	for (const name of Object.keys(headers)) {
		sanitized[name] = shortSecretHash(headers[name])
	}
	return sanitized
}

/**
 * Sanitize an arbitrary extras value. Strings are replaced with an opaque
 * `{kind: "string", hash}` record so user-supplied tokens that get
 * smuggled into extras cannot leak through the fingerprint pipeline.
 * Numbers, booleans, and null are preserved as-is because they cannot
 * carry secret material and their identity matters for fingerprint
 * differentiation. Arrays preserve order. Object key ordering is not
 * preserved here — `canonicalStringify` re-sorts keys at the final step.
 * Undefined object fields are dropped to match canonicalization behavior.
 */
function sanitizeExtrasValue(value: unknown): unknown {
	if (value === null) {
		return null
	}
	if (typeof value === "string") {
		return { kind: "string", hash: sha256Hex(value).slice(0, SECRET_HASH_LENGTH) }
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return value
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeExtrasValue(item))
	}
	if (typeof value === "object") {
		const record = value as Readonly<Record<string, unknown>>
		const sanitized: Record<string, unknown> = {}
		for (const key of Object.keys(record)) {
			const child = record[key]
			if (child === undefined) {
				continue
			}
			sanitized[key] = sanitizeExtrasValue(child)
		}
		return sanitized
	}
	// `undefined`, `bigint`, `symbol`, `function` — collapse to null. These
	// should never reach this function via a well-typed EffectiveProviderConfig
	// but we handle them defensively so the fingerprint stays total.
	return null
}

function sanitizeExtras(extras: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> | null {
	if (!extras) {
		return null
	}
	const result = sanitizeExtrasValue(extras)
	// `sanitizeExtrasValue` of a plain object returns a record; the cast
	// is local and trivially correct given the branch above.
	return result as Readonly<Record<string, unknown>>
}

/**
 * Canonical JSON serialization with deterministic key ordering at every
 * object depth. Arrays preserve order because array order is meaningful.
 * Undefined object properties are dropped to mirror JSON.stringify and avoid
 * treating absent optional fields differently from explicitly-undefined ones.
 */
function canonicalStringify(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value) ?? "null"
	}

	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalStringify(item)).join(",")}]`
	}

	const record = value as Readonly<Record<string, unknown>>
	const entries = Object.keys(record)
		.filter((key) => record[key] !== undefined)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`)

	return `{${entries.join(",")}}`
}

/**
 * Compute a fingerprint for the given provider effective config.
 *
 * Invariant: total, pure, deterministic. Same `(providerId, config)` always
 * produces the same fingerprint; different inputs produce different
 * fingerprints (up to hash collision). Raw secrets never appear in the
 * output *or* in the intermediate sanitized payload that is fed into the
 * final hash. Header values and extras string values are hashed before
 * canonicalization so even an attacker with access to the pre-hash payload
 * cannot recover raw secrets.
 */
export function computeConfigFingerprint(providerId: ProviderId, config: EffectiveProviderConfig): Fingerprint {
	const payload = {
		version: FINGERPRINT_VERSION,
		providerId,
		configProviderId: config.providerId,
		baseUrl: config.baseUrl ?? null,
		apiLine: config.apiLine ?? null,
		headers: sanitizeHeaders(config.headers),
		region: config.region ?? null,
		extras: sanitizeExtras(config.extras),
		auth: {
			accountId: config.auth?.accountId ?? null,
			accessToken: shortSecretHash(config.auth?.accessToken),
			refreshToken: shortSecretHash(config.auth?.refreshToken),
		},
		apiKey: shortSecretHash(config.apiKey),
	}

	return `config:v${FINGERPRINT_VERSION}:${sha256Hex(canonicalStringify(payload))}` as Fingerprint
}
