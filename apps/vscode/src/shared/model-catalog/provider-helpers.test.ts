import { describe, expect, it } from "vitest"
import {
	areProviderIdsEquivalent,
	isProviderAllowedByRemoteConfig,
	isVscodeUnsupportedProvider,
	toLegacyApiProvider,
	toVscodeSupportedProvider,
} from "./provider-helpers"

describe("toLegacyApiProvider", () => {
	it("up-cases the nousResearch id to its legacy ApiConfiguration spelling", () => {
		expect(toLegacyApiProvider("nousResearch")).toBe("nousResearch")
		expect(toLegacyApiProvider("nousresearch")).toBe("nousResearch")
	})

	it("maps the SDK OpenAI Compatible provider to the extension's legacy openai id", () => {
		expect(toLegacyApiProvider("openai-compatible")).toBe("openai")
	})

	it("passes through other ids unchanged", () => {
		expect(toLegacyApiProvider("deepseek")).toBe("deepseek")
		expect(toLegacyApiProvider("anthropic")).toBe("anthropic")
		expect(toLegacyApiProvider("openai-codex")).toBe("openai-codex")
		expect(toLegacyApiProvider("openai-native")).toBe("openai-native")
	})
})

describe("areProviderIdsEquivalent", () => {
	it("treats SDK and legacy aliases as the same provider", () => {
		expect(areProviderIdsEquivalent("openai", "openai-compatible")).toBe(true)
		expect(areProviderIdsEquivalent("openai-compatible", "openai")).toBe(true)
		expect(areProviderIdsEquivalent("nousresearch", "nousResearch")).toBe(true)
	})

	it("does not match unrelated or missing providers", () => {
		expect(areProviderIdsEquivalent("openai", "openai-native")).toBe(false)
		expect(areProviderIdsEquivalent("anthropic", undefined)).toBe(false)
	})
})

describe("isProviderAllowedByRemoteConfig", () => {
	it("matches remote configured providers through SDK and legacy aliases", () => {
		expect(isProviderAllowedByRemoteConfig("openai", ["openai-compatible"])).toBe(true)
		expect(isProviderAllowedByRemoteConfig("openai-compatible", ["openai"])).toBe(true)
	})

	it("rejects unrelated and missing providers", () => {
		expect(isProviderAllowedByRemoteConfig("openai", ["anthropic"])).toBe(false)
		expect(isProviderAllowedByRemoteConfig(undefined, ["openai-compatible"])).toBe(false)
	})
})

describe("VS Code provider support helpers", () => {
	it("identifies providers VS Code intentionally hides until host auth is implemented", () => {
		expect(isVscodeUnsupportedProvider("claude-code")).toBe(true)
		expect(isVscodeUnsupportedProvider("qwen-code")).toBe(true)
		expect(isVscodeUnsupportedProvider("dify")).toBe(true)
		expect(isVscodeUnsupportedProvider("openai-codex")).toBe(false)
	})

	it("falls unsupported or missing providers back to the VS Code default", () => {
		expect(toVscodeSupportedProvider("qwen-code")).toBe("cline")
		expect(toVscodeSupportedProvider("dify")).toBe("cline")
		expect(toVscodeSupportedProvider(undefined)).toBe("cline")
		expect(toVscodeSupportedProvider("openai-compatible")).toBe("openai")
		expect(toVscodeSupportedProvider("deepseek")).toBe("deepseek")
	})
})
