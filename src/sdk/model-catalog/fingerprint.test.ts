import { describe, expect, it } from "vitest"
import type { EffectiveProviderConfig } from "./contracts"
import { computeConfigFingerprint } from "./fingerprint"
import { parseProviderId } from "./provider-id"

const providerId = parseProviderId("litellm")

function makeConfig(overrides: Partial<EffectiveProviderConfig> = {}): EffectiveProviderConfig {
	return {
		providerId,
		baseUrl: "https://models.example.com/v1",
		apiKey: "api-key-a",
		apiLine: "default",
		headers: {
			authorization: "Bearer header-token-a",
			"x-team": "catalog",
		},
		region: "us-east-1",
		extras: {
			deployment: "primary",
			nested: {
				beta: true,
				weight: 2,
			},
		},
		auth: {
			accountId: "account-a",
			accessToken: "access-token-a",
			refreshToken: "refresh-token-a",
		},
		...overrides,
	}
}

describe("computeConfigFingerprint", () => {
	it("returns the same fingerprint for the same input", () => {
		const config = makeConfig()

		expect(computeConfigFingerprint(providerId, config)).toBe(computeConfigFingerprint(providerId, config))
	})

	it("changes when the baseUrl changes", () => {
		expect(computeConfigFingerprint(providerId, makeConfig({ baseUrl: "https://models-a.example.com" }))).not.toBe(
			computeConfigFingerprint(providerId, makeConfig({ baseUrl: "https://models-b.example.com" })),
		)
	})

	it("changes when the apiKey changes", () => {
		expect(computeConfigFingerprint(providerId, makeConfig({ apiKey: "api-key-a" }))).not.toBe(
			computeConfigFingerprint(providerId, makeConfig({ apiKey: "api-key-b" })),
		)
	})

	it("changes when the apiLine changes", () => {
		expect(computeConfigFingerprint(providerId, makeConfig({ apiLine: "commercial" }))).not.toBe(
			computeConfigFingerprint(providerId, makeConfig({ apiLine: "international" })),
		)
	})

	it("changes when the region changes", () => {
		expect(computeConfigFingerprint(providerId, makeConfig({ region: "us-east-1" }))).not.toBe(
			computeConfigFingerprint(providerId, makeConfig({ region: "eu-west-1" })),
		)
	})

	it("changes when a headers value changes", () => {
		expect(computeConfigFingerprint(providerId, makeConfig({ headers: { a: "1", b: "2" } }))).not.toBe(
			computeConfigFingerprint(providerId, makeConfig({ headers: { a: "1", b: "3" } })),
		)
	})

	it("does not change when headers keys are ordered differently", () => {
		expect(computeConfigFingerprint(providerId, makeConfig({ headers: { b: "2", a: "1" } }))).toBe(
			computeConfigFingerprint(providerId, makeConfig({ headers: { a: "1", b: "2" } })),
		)
	})

	it("changes when extras change", () => {
		expect(computeConfigFingerprint(providerId, makeConfig({ extras: { nested: { a: 1, b: true } } }))).not.toBe(
			computeConfigFingerprint(providerId, makeConfig({ extras: { nested: { a: 1, b: false } } })),
		)
	})

	it("does not change when extras keys are ordered differently", () => {
		expect(computeConfigFingerprint(providerId, makeConfig({ extras: { nested: { b: 2, a: 1 } } }))).toBe(
			computeConfigFingerprint(providerId, makeConfig({ extras: { nested: { a: 1, b: 2 } } })),
		)
	})

	it("changes when auth accessToken or refreshToken changes", () => {
		const baseAuth = { accountId: "account-a", accessToken: "access-token-a", refreshToken: "refresh-token-a" }

		expect(computeConfigFingerprint(providerId, makeConfig({ auth: baseAuth }))).not.toBe(
			computeConfigFingerprint(providerId, makeConfig({ auth: { ...baseAuth, accessToken: "access-token-b" } })),
		)
		expect(computeConfigFingerprint(providerId, makeConfig({ auth: baseAuth }))).not.toBe(
			computeConfigFingerprint(providerId, makeConfig({ auth: { ...baseAuth, refreshToken: "refresh-token-b" } })),
		)
	})

	it("changes when auth accountId changes", () => {
		expect(
			computeConfigFingerprint(
				providerId,
				makeConfig({ auth: { accountId: "account-a", accessToken: "access-token-a", refreshToken: "refresh-token-a" } }),
			),
		).not.toBe(
			computeConfigFingerprint(
				providerId,
				makeConfig({ auth: { accountId: "account-b", accessToken: "access-token-a", refreshToken: "refresh-token-a" } }),
			),
		)
	})

	it("does not include raw secret sentinel values in the returned fingerprint", () => {
		const fingerprint = computeConfigFingerprint(
			providerId,
			makeConfig({
				apiKey: "SECRET_SENTINEL_API_KEY",
				auth: {
					accountId: "account-a",
					accessToken: "SECRET_SENTINEL_ACCESS_TOKEN",
					refreshToken: "SECRET_SENTINEL_REFRESH_TOKEN",
				},
			}),
		)

		expect(fingerprint).not.toContain("SECRET_SENTINEL")
		expect(fingerprint).not.toContain("SECRET_SENTINEL_API_KEY")
		expect(fingerprint).not.toContain("SECRET_SENTINEL_ACCESS_TOKEN")
		expect(fingerprint).not.toContain("SECRET_SENTINEL_REFRESH_TOKEN")
	})

	it("changes when the providerId argument changes", () => {
		const otherProviderId = parseProviderId("openai")

		expect(computeConfigFingerprint(providerId, makeConfig())).not.toBe(
			computeConfigFingerprint(otherProviderId, makeConfig({ providerId: otherProviderId })),
		)
	})

	it("uses config providerId as part of the fingerprint input", () => {
		const otherProviderId = parseProviderId("openai")

		expect(computeConfigFingerprint(providerId, makeConfig({ providerId }))).not.toBe(
			computeConfigFingerprint(providerId, makeConfig({ providerId: otherProviderId })),
		)
	})

	it("returns a versioned full sha256 fingerprint", () => {
		const fingerprint = computeConfigFingerprint(providerId, makeConfig())
		const value: string = fingerprint

		expect(value).toMatch(/^config:v1:[a-f0-9]{64}$/)
	})
})
