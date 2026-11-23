import { describe, expect, it } from "vitest"
import { reshapeErrorForWebview } from "./message-translator"
import { describeMissingCredentialError } from "./provider-credential-error"

describe("describeMissingCredentialError", () => {
	it("rewrites a missing Authorization header error into actionable guidance", () => {
		expect(describeMissingCredentialError("Missing Authorization header", "vercel-ai-gateway")).toBe(
			'Missing API key for provider "vercel-ai-gateway". Add credentials in Settings, or switch providers.',
		)
	})

	it("names the provider it was given", () => {
		expect(describeMissingCredentialError("Missing Authorization header", "openrouter")).toBe(
			'Missing API key for provider "openrouter". Add credentials in Settings, or switch providers.',
		)
	})

	it("does not name a provider when the id is unknown", () => {
		expect(describeMissingCredentialError("Missing Authorization header")).toBe(
			"Missing API key for the active provider. Add credentials in Settings, or switch providers.",
		)
	})

	it.each([
		"No Authorization header",
		"Authorization header is required",
		"missing authorization HEADER",
		"AI Gateway error: Missing Authorization header (401)",
	])("matches the no-header signature in %j", (rawMessage) => {
		expect(describeMissingCredentialError(rawMessage, "vercel-ai-gateway")).toBe(
			'Missing API key for provider "vercel-ai-gateway". Add credentials in Settings, or switch providers.',
		)
	})

	it.each([
		"Invalid API key",
		"Unauthorized",
		"authentication failed",
		"invalid_api_key",
		"Model not found",
		"",
	])("leaves %j untouched so a wrong key is never relabelled as missing", (rawMessage) => {
		expect(describeMissingCredentialError(rawMessage, "openai")).toBeUndefined()
	})
})

describe("reshapeErrorForWebview - missing credentials", () => {
	it("surfaces actionable guidance instead of the raw provider 401", () => {
		expect(reshapeErrorForWebview({ message: "Missing Authorization header" }, "vercel-ai-gateway")).toBe(
			'Missing API key for provider "vercel-ai-gateway". Add credentials in Settings, or switch providers.',
		)
	})

	it("passes an invalid-key error through unchanged when unclassified", () => {
		expect(reshapeErrorForWebview({ message: "Invalid API key" }, "openai")).toBe("Invalid API key")
	})

	it("does not blame the cline provider when the active provider id is unknown", () => {
		expect(reshapeErrorForWebview({ message: "Missing Authorization header" })).toBe(
			"Missing API key for the active provider. Add credentials in Settings, or switch providers.",
		)
	})
})

describe("reshapeErrorForWebview - rejected credentials (errorClass auth)", () => {
	it("rewrites a classified 401 into actionable guidance and keeps the provider body", () => {
		const reshaped = reshapeErrorForWebview(
			{ message: '{"detail":"Invalid API Key"}' },
			"mistral",
			"mistral-large-2512",
			"auth",
		)
		expect(reshaped).toBe(
			'Provider "mistral" rejected the configured credentials. Re-enter the API key in Settings → API Configuration (checking it is the right kind of key for this provider), or switch providers.\n\nProvider response: {"detail":"Invalid API Key"}',
		)
	})

	it("keeps the cline provider on the JSON path so the webview renders the sign-in card", () => {
		const reshaped = reshapeErrorForWebview(
			{ message: '{"status":401,"message":"Unauthorized"}' },
			"cline",
			undefined,
			"auth",
		)
		expect(reshaped).toBe('{"status":401,"message":"Unauthorized"}')
	})

	it("keeps cline-pass on the JSON path as well", () => {
		const reshaped = reshapeErrorForWebview(
			{ message: '{"status":401,"message":"Unauthorized"}' },
			"cline-pass",
			undefined,
			"auth",
		)
		expect(reshaped).toBe('{"status":401,"message":"Unauthorized"}')
	})

	it("does not rewrite unclassified errors", () => {
		expect(reshapeErrorForWebview({ message: "boom" }, "mistral", undefined, "unknown")).toBe("boom")
	})

	it("does not rewrite when the provider id is unknown, so a cline-account sign-in card is never suppressed", () => {
		expect(reshapeErrorForWebview({ message: '{"status":401,"message":"Unauthorized"}' }, undefined, undefined, "auth")).toBe(
			'{"status":401,"message":"Unauthorized"}',
		)
	})
})
