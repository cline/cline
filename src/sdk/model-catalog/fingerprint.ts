import { createHash } from "node:crypto"
import type { EffectiveProviderConfig, Fingerprint, ProviderId } from "./contracts"

const FINGERPRINT_VERSION = 1
const SECRET_HASH_LENGTH = 12

function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex")
}

function shortSecretHash(value: string | undefined): { readonly present: boolean; readonly hash?: string } {
	if (typeof value !== "string" || value.length === 0) {
		return { present: false }
	}

	return { present: true, hash: sha256Hex(value).slice(0, SECRET_HASH_LENGTH) }
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
 * output.
 */
export function computeConfigFingerprint(providerId: ProviderId, config: EffectiveProviderConfig): Fingerprint {
	const payload = {
		version: FINGERPRINT_VERSION,
		providerId,
		configProviderId: config.providerId,
		baseUrl: config.baseUrl ?? null,
		apiLine: config.apiLine ?? null,
		headers: config.headers ?? null,
		region: config.region ?? null,
		extras: config.extras ?? null,
		auth: {
			accountId: config.auth?.accountId ?? null,
			accessToken: shortSecretHash(config.auth?.accessToken),
			refreshToken: shortSecretHash(config.auth?.refreshToken),
		},
		apiKey: shortSecretHash(config.apiKey),
	}

	return `config:v${FINGERPRINT_VERSION}:${sha256Hex(canonicalStringify(payload))}` as Fingerprint
}
