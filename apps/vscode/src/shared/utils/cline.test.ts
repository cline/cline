import { describe, expect, it } from "vitest"
import { findUsageBilledModelId, isClineManagedProvider } from "./cline"

const CLINE_CATALOG = [
	"anthropic/claude-opus-5",
	"deepseek/deepseek-v4-flash",
	"deepseek/deepseek-v4-pro",
	"poolside/laguna-s-2.1:free",
	"cline-free/glm-5.2",
	"zai/glm-5.2",
]

describe("isClineManagedProvider", () => {
	it("treats both Cline account providers as Cline providers", () => {
		expect(isClineManagedProvider("cline")).toBe(true)
		expect(isClineManagedProvider("cline-pass")).toBe(true)
		expect(isClineManagedProvider("anthropic")).toBe(false)
		expect(isClineManagedProvider(undefined)).toBe(false)
	})
})

describe("findUsageBilledModelId", () => {
	it("maps a ClinePass model to its usage-billed twin", () => {
		expect(findUsageBilledModelId("cline-pass/deepseek-v4-flash", CLINE_CATALOG)).toBe("deepseek/deepseek-v4-flash")
		expect(findUsageBilledModelId("cline-pass/glm-5.2", CLINE_CATALOG)).toBe("zai/glm-5.2")
	})

	it("maps a Cline free model to its usage-billed twin", () => {
		expect(findUsageBilledModelId("cline-free/glm-5.2", CLINE_CATALOG)).toBe("zai/glm-5.2")
	})

	it("ignores model ids that are already usage-billed", () => {
		expect(findUsageBilledModelId("deepseek/deepseek-v4-flash", CLINE_CATALOG)).toBeUndefined()
		expect(findUsageBilledModelId(undefined, CLINE_CATALOG)).toBeUndefined()
	})

	it("returns nothing when the catalog has no matching slug", () => {
		expect(findUsageBilledModelId("cline-pass/subscription-only", CLINE_CATALOG)).toBeUndefined()
		// ":free" variants are distinct slugs, so they never stand in for a paid twin
		expect(findUsageBilledModelId("cline-pass/laguna-s-2.1", CLINE_CATALOG)).toBeUndefined()
	})
})
