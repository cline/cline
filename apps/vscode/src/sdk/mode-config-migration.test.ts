import { describe, expect, it } from "vitest"
import {
	buildModeConfigurations,
	getModeConfigValue,
	hasFlatModeKeys,
	MODE_CONFIGURATION_VERSION_KEY,
	MODE_CONFIGURATIONS_KEY,
	runModeConfigMigration,
	shouldRunModeConfigMigration,
	splitModeKey,
} from "./mode-config-migration"

describe("splitModeKey", () => {
	it("splits plan-prefixed keys", () => {
		expect(splitModeKey("planModeApiModelId")).toEqual({ mode: "plan", rest: "ApiModelId" })
	})

	it("splits act-prefixed keys", () => {
		expect(splitModeKey("actModeOpenRouterModelId")).toEqual({ mode: "act", rest: "OpenRouterModelId" })
	})

	it("handles mode segments embedded mid-key (gemini*)", () => {
		expect(splitModeKey("geminiPlanModeThinkingLevel")).toEqual({ mode: "plan", rest: "geminiThinkingLevel" })
		expect(splitModeKey("geminiActModeThinkingLevel")).toEqual({ mode: "act", rest: "geminiThinkingLevel" })
	})

	it("returns undefined for keys without a mode segment", () => {
		expect(splitModeKey("apiModelId")).toBeUndefined()
		expect(splitModeKey("maxConsecutiveMistakes")).toBeUndefined()
		expect(splitModeKey("")).toBeUndefined()
	})
})

describe("buildModeConfigurations", () => {
	it("groups flat keys per mode, stripping the mode segment", () => {
		const configs = buildModeConfigurations({
			planModeApiModelId: "claude-sonnet",
			planModeThinkingBudgetTokens: 1000,
			actModeApiModelId: "claude-opus",
			geminiPlanModeThinkingLevel: "high",
			apiModelId: "not-mode-specific",
			unrelatedSetting: 42,
		})
		expect(configs.plan).toEqual({
			ApiModelId: "claude-sonnet",
			ThinkingBudgetTokens: 1000,
			geminiThinkingLevel: "high",
		})
		expect(configs.act).toEqual({ ApiModelId: "claude-opus" })
	})

	it("skips undefined values", () => {
		const configs = buildModeConfigurations({ planModeApiModelId: undefined, planModeVerbosity: "normal" })
		expect(configs.plan).toEqual({ Verbosity: "normal" })
	})

	it("returns an empty record when nothing matches", () => {
		expect(buildModeConfigurations({ apiModelId: "x" })).toEqual({})
	})
})

describe("hasFlatModeKeys / shouldRunModeConfigMigration", () => {
	it("detects legacy flat keys", () => {
		expect(hasFlatModeKeys({ planModeApiModelId: "x" })).toBe(true)
		expect(hasFlatModeKeys({ apiModelId: "x" })).toBe(false)
	})

	it("requires both legacy data AND a stale sentinel", () => {
		const settings = { planModeApiModelId: "x" }
		expect(shouldRunModeConfigMigration(settings, undefined)).toBe(true)
		expect(shouldRunModeConfigMigration(settings, 0)).toBe(true)
		expect(shouldRunModeConfigMigration(settings, 1)).toBe(false)
		expect(shouldRunModeConfigMigration({}, undefined)).toBe(false)
	})
})

describe("runModeConfigMigration", () => {
	it("writes the nested config and bumps the sentinel (dual-write keeps flat keys)", () => {
		const settings = { planModeApiModelId: "claude-sonnet", actModeApiModelId: "claude-opus" }
		let written: unknown
		let version = 0
		const result = runModeConfigMigration(settings, version, {
			getFlat: () => undefined,
			setNested: (configs, v) => {
				written = configs
				version = v
			},
		})
		expect(result?.plan?.ApiModelId).toBe("claude-sonnet")
		expect(result?.act?.ApiModelId).toBe("claude-opus")
		expect(written).toEqual(result)
		expect(version).toBe(1)
		// Flat keys are untouched -> downgrade-safe
		expect(settings.planModeApiModelId).toBe("claude-sonnet")
	})

	it("is a no-op once the sentinel is at the current version", () => {
		let writes = 0
		const result = runModeConfigMigration({ planModeApiModelId: "x" }, 1, {
			getFlat: () => undefined,
			setNested: () => {
				writes++
			},
		})
		expect(result).toBeUndefined()
		expect(writes).toBe(0)
	})

	it("is a no-op when there is no legacy data", () => {
		let writes = 0
		const result = runModeConfigMigration({ apiModelId: "x" }, 0, {
			getFlat: () => undefined,
			setNested: () => {
				writes++
			},
		})
		expect(result).toBeUndefined()
		expect(writes).toBe(0)
	})
})

describe("getModeConfigValue", () => {
	it("resolves a flat key against the nested record", () => {
		const configs = { plan: { ApiModelId: "claude-sonnet" } }
		expect(getModeConfigValue(configs, "plan", "planModeApiModelId")).toBe("claude-sonnet")
	})

	it("returns undefined for a mismatched mode or unknown key", () => {
		const configs = { plan: { apiModelId: "claude-sonnet" } }
		expect(getModeConfigValue(configs, "act", "planModeApiModelId")).toBeUndefined()
		expect(getModeConfigValue(configs, "plan", "planModeVerbosity")).toBeUndefined()
		expect(getModeConfigValue(undefined, "plan", "planModeApiModelId")).toBeUndefined()
	})
})

describe("storage key constants", () => {
	it("exports the state keys used by the controller", () => {
		expect(MODE_CONFIGURATIONS_KEY).toBe("modeConfigurations")
		expect(MODE_CONFIGURATION_VERSION_KEY).toBe("modeConfigurationVersion")
	})
})
