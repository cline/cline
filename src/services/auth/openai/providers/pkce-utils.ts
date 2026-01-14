import crypto from "crypto"

/**
 * Generates a code verifier for PKCE flow.
 */
export function generateCodeVerifier(): string {
	return base64URLEncode(crypto.randomBytes(32))
}

/**
 * Generates a code challenge from a code verifier.
 */
export function pkceChallengeFromVerifier(verifier: string): string {
	const hash = crypto.createHash("sha256").update(verifier).digest()
	return base64URLEncode(hash)
}

/**
 * Base64 URL-safe encoding.
 */
function base64URLEncode(buffer: Buffer): string {
	return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

/**
 * Generates a random string for state/nonce.
 */
export function generateRandomString(length: number): string {
	return base64URLEncode(crypto.randomBytes(length))
}
