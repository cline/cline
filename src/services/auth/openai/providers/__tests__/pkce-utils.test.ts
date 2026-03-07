import * as assert from "assert"
import crypto from "crypto"
import { describe, it } from "mocha"
import { generateCodeVerifier, generateRandomString, pkceChallengeFromVerifier } from "../pkce-utils"

describe("pkce-utils", () => {
	describe("generateCodeVerifier()", () => {
		it("should generate a base64url-encoded string", () => {
			const verifier = generateCodeVerifier()
			assert.strictEqual(typeof verifier, "string")
			assert.ok(verifier.length > 0)
			assert.ok(!/[+/=]/.test(verifier), "Should not contain +, /, or =")
		})

		it("should generate unique verifiers on multiple calls", () => {
			const verifier1 = generateCodeVerifier()
			const verifier2 = generateCodeVerifier()
			assert.notStrictEqual(verifier1, verifier2)
		})

		it("should generate verifier of expected length (43 chars)", () => {
			const verifier = generateCodeVerifier()
			assert.strictEqual(verifier.length, 43)
		})
	})

	describe("pkceChallengeFromVerifier()", () => {
		it("should generate correct SHA-256 hash", () => {
			const verifier = "test-verifier"
			const challenge = pkceChallengeFromVerifier(verifier)

			const expectedHash = crypto.createHash("sha256").update(verifier).digest()
			const expected = expectedHash.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")

			assert.strictEqual(challenge, expected)
		})

		it("should produce same challenge for same verifier", () => {
			const verifier = "consistent"
			const challenge1 = pkceChallengeFromVerifier(verifier)
			const challenge2 = pkceChallengeFromVerifier(verifier)
			assert.strictEqual(challenge1, challenge2)
		})

		it("should produce different challenges for different verifiers", () => {
			const challenge1 = pkceChallengeFromVerifier("one")
			const challenge2 = pkceChallengeFromVerifier("two")
			assert.notStrictEqual(challenge1, challenge2)
		})
	})

	describe("generateRandomString()", () => {
		it("should generate string", () => {
			const str = generateRandomString(16)
			assert.strictEqual(typeof str, "string")
			assert.ok(str.length > 0)
		})

		it("should generate unique strings", () => {
			const str1 = generateRandomString(32)
			const str2 = generateRandomString(32)
			assert.notStrictEqual(str1, str2)
		})

		it("should only contain base64url-safe characters", () => {
			const str = generateRandomString(24)
			assert.ok(/^[A-Za-z0-9_-]+$/.test(str))
		})
	})

	describe("PKCE flow integration", () => {
		it("should generate valid verifier and challenge pair", () => {
			const verifier = generateCodeVerifier()
			const challenge = pkceChallengeFromVerifier(verifier)

			assert.notStrictEqual(verifier, challenge)
			assert.strictEqual(verifier.length, 43)
			assert.strictEqual(challenge.length, 43)
		})
	})
})
