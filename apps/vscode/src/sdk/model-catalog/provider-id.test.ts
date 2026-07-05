import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Logger } from "../../shared/services/Logger"
import type { KnownProviderId } from "./contracts"
import { isKnownProviderId, parseProviderId } from "./provider-id"

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
	warnSpy = vi.spyOn(Logger, "warn").mockImplementation(() => {})
})

afterEach(() => {
	warnSpy.mockRestore()
})

describe("parseProviderId", () => {
	it("trims whitespace and lowercases the provider id", () => {
		expect(parseProviderId("  Anthropic  ")).toBe("anthropic")
		expect(parseProviderId("\tOPENROUTER\n")).toBe("openrouter")
	})

	it("accepts arbitrary custom provider ids", () => {
		expect(parseProviderId("  Custom-SDK-Provider  ")).toBe("custom-sdk-provider")
	})

	it("normalizes the legacy camel-case nousResearch id", () => {
		expect(parseProviderId("nousResearch")).toBe("nousresearch")
		expect(parseProviderId("NOUSRESEARCH")).toBe("nousresearch")
	})

	it("warns once per non-empty unknown provider id", () => {
		parseProviderId("provider-id-test-unknown-a")
		parseProviderId("provider-id-test-unknown-a")
		parseProviderId("provider-id-test-unknown-b")
		parseProviderId("   ")

		const warnings = warnSpy.mock.calls.filter((call: unknown[]) => {
			const message = call[0]
			return typeof message === "string" && message.includes("provider-id-test-unknown-")
		})
		expect(warnings).toHaveLength(2)
	})

	it("does not warn for known provider ids", () => {
		parseProviderId("anthropic")
		parseProviderId("openai")
		parseProviderId("nousResearch")
		parseProviderId("zai-coding-plan")
		parseProviderId("poolside")
		parseProviderId("v0")
		parseProviderId("xiaomi")
		parseProviderId("tencent-tokenhub")
		parseProviderId("manifest")

		expect(warnSpy).not.toHaveBeenCalled()
	})
})

describe("isKnownProviderId", () => {
	it("returns true for known provider ids after parsing", () => {
		expect(isKnownProviderId(parseProviderId("anthropic"))).toBe(true)
		expect(isKnownProviderId(parseProviderId("openai"))).toBe(true)
		expect(isKnownProviderId(parseProviderId("deepseek"))).toBe(true)
		expect(isKnownProviderId(parseProviderId("nousResearch"))).toBe(true)
		expect(isKnownProviderId(parseProviderId("zai-coding-plan"))).toBe(true)
		expect(isKnownProviderId(parseProviderId("poolside"))).toBe(true)
		expect(isKnownProviderId(parseProviderId("v0"))).toBe(true)
		expect(isKnownProviderId(parseProviderId("xiaomi"))).toBe(true)
		expect(isKnownProviderId(parseProviderId("tencent-tokenhub"))).toBe(true)
		expect(isKnownProviderId(parseProviderId("manifest"))).toBe(true)
	})

	it("returns false for a custom provider id", () => {
		expect(isKnownProviderId(parseProviderId("provider-id-test-custom-provider"))).toBe(false)
	})

	it("acts as a type predicate", () => {
		const id = parseProviderId("anthropic")
		if (!isKnownProviderId(id)) {
			throw new Error("expected anthropic to be known")
		}

		const knownProviderId: KnownProviderId = id
		expect(knownProviderId).toBe("anthropic")
	})
})
