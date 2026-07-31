import { describe, expect, it } from "bun:test"
import { findUsageBasedClineModelId, getClinePassModelSlug, isClinePassModelId } from "../cline-pass-models"

const CLINE_CATALOG_MODEL_IDS = [
	"anthropic/claude-opus-4.6",
	"deepseek/deepseek-v4-flash",
	"deepseek/deepseek-v4-pro",
	"z-ai/glm-5.2",
	"moonshotai/kimi-k3",
	"cline-free/deepseek-v4-flash",
]

describe("isClinePassModelId", () => {
	it("matches only cline-pass ids", () => {
		expect(isClinePassModelId("cline-pass/deepseek-v4-flash")).toBe(true)
		expect(isClinePassModelId("  CLINE-PASS/GLM-5.2 ")).toBe(true)
		expect(isClinePassModelId("deepseek/deepseek-v4-flash")).toBe(false)
		expect(isClinePassModelId("cline-free/deepseek-v4-flash")).toBe(false)
		expect(isClinePassModelId(undefined)).toBe(false)
	})
})

describe("getClinePassModelSlug", () => {
	it("returns the slug after the prefix", () => {
		expect(getClinePassModelSlug("cline-pass/deepseek-v4-flash")).toBe("deepseek-v4-flash")
	})

	it("returns undefined for non-ClinePass or empty slugs", () => {
		expect(getClinePassModelSlug("cline-pass/")).toBeUndefined()
		expect(getClinePassModelSlug("deepseek/deepseek-v4-flash")).toBeUndefined()
	})
})

describe("findUsageBasedClineModelId", () => {
	it("resolves the lab-prefixed counterpart of a ClinePass model", () => {
		expect(findUsageBasedClineModelId("cline-pass/deepseek-v4-flash", CLINE_CATALOG_MODEL_IDS)).toBe(
			"deepseek/deepseek-v4-flash",
		)
		expect(findUsageBasedClineModelId("cline-pass/glm-5.2", CLINE_CATALOG_MODEL_IDS)).toBe("z-ai/glm-5.2")
		expect(findUsageBasedClineModelId("cline-pass/kimi-k3", CLINE_CATALOG_MODEL_IDS)).toBe("moonshotai/kimi-k3")
	})

	it("matches an unprefixed catalog id with the same slug", () => {
		expect(findUsageBasedClineModelId("cline-pass/glm-5.2", ["glm-5.2"])).toBe("glm-5.2")
	})

	it("never resolves to another gated or promotional id", () => {
		expect(
			findUsageBasedClineModelId("cline-pass/deepseek-v4-flash", [
				"cline-free/deepseek-v4-flash",
				"cline-pass/deepseek-v4-flash",
			]),
		).toBeUndefined()
	})

	it("returns undefined when the model is not a ClinePass id or has no counterpart", () => {
		expect(findUsageBasedClineModelId("deepseek/deepseek-v4-flash", CLINE_CATALOG_MODEL_IDS)).toBeUndefined()
		expect(findUsageBasedClineModelId("cline-pass/unlisted-model", CLINE_CATALOG_MODEL_IDS)).toBeUndefined()
		expect(findUsageBasedClineModelId(undefined, CLINE_CATALOG_MODEL_IDS)).toBeUndefined()
	})
})
