import { describe, expect, it } from "bun:test"
import {
	findUsageBasedClineModelId,
	getSyntheticClineModelSlug,
	isClineFreeModelId,
	isClinePassModelId,
} from "../cline-model-namespaces"

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

describe("isClineFreeModelId", () => {
	it("matches only cline-free ids", () => {
		expect(isClineFreeModelId("cline-free/deepseek-v4-flash")).toBe(true)
		expect(isClineFreeModelId("Cline-Free/GLM-5.2")).toBe(true)
		expect(isClineFreeModelId("cline-pass/deepseek-v4-flash")).toBe(false)
		expect(isClineFreeModelId("deepseek/deepseek-v4-flash")).toBe(false)
		expect(isClineFreeModelId(undefined)).toBe(false)
	})
})

describe("getSyntheticClineModelSlug", () => {
	it("returns the slug after either synthetic prefix", () => {
		expect(getSyntheticClineModelSlug("cline-pass/deepseek-v4-flash")).toBe("deepseek-v4-flash")
		expect(getSyntheticClineModelSlug("cline-free/glm-5.2")).toBe("glm-5.2")
	})

	it("returns undefined for non-synthetic or empty slugs", () => {
		expect(getSyntheticClineModelSlug("cline-pass/")).toBeUndefined()
		expect(getSyntheticClineModelSlug("cline-free/")).toBeUndefined()
		expect(getSyntheticClineModelSlug("deepseek/deepseek-v4-flash")).toBeUndefined()
		expect(getSyntheticClineModelSlug(undefined)).toBeUndefined()
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

	it("resolves the paid counterpart of a Cline free model", () => {
		expect(findUsageBasedClineModelId("cline-free/deepseek-v4-flash", CLINE_CATALOG_MODEL_IDS)).toBe(
			"deepseek/deepseek-v4-flash",
		)
	})

	it("matches an unprefixed catalog id with the same slug", () => {
		expect(findUsageBasedClineModelId("cline-pass/glm-5.2", ["glm-5.2"])).toBe("glm-5.2")
	})

	it("never resolves to another synthetic id", () => {
		const syntheticOnlyCatalog = ["cline-free/deepseek-v4-flash", "cline-pass/deepseek-v4-flash"]
		expect(findUsageBasedClineModelId("cline-pass/deepseek-v4-flash", syntheticOnlyCatalog)).toBeUndefined()
		expect(findUsageBasedClineModelId("cline-free/deepseek-v4-flash", syntheticOnlyCatalog)).toBeUndefined()
	})

	it("returns undefined when the model is not synthetic or has no counterpart", () => {
		expect(findUsageBasedClineModelId("deepseek/deepseek-v4-flash", CLINE_CATALOG_MODEL_IDS)).toBeUndefined()
		expect(findUsageBasedClineModelId("cline-pass/unlisted-model", CLINE_CATALOG_MODEL_IDS)).toBeUndefined()
		expect(findUsageBasedClineModelId(undefined, CLINE_CATALOG_MODEL_IDS)).toBeUndefined()
	})
})
