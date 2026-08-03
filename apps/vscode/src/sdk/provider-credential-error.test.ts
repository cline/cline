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

	it("passes an invalid-key error through unchanged", () => {
		expect(reshapeErrorForWebview({ message: "Invalid API key" }, "openai")).toBe("Invalid API key")
	})

	it("does not blame the cline provider when the active provider id is unknown", () => {
		expect(reshapeErrorForWebview({ message: "Missing Authorization header" })).toBe(
			"Missing API key for the active provider. Add credentials in Settings, or switch providers.",
		)
	})
})
