// Real prompt builder from the SDK package — same one the session config
// builder uses — so this test quantifies the actual plan/act delta.
import { buildClineSystemPrompt } from "@cline/shared"
import { describe, expect, it } from "vitest"
import {
	commonPrefixLength,
	findToolDelta,
	measureSharedPrefixRatio,
	PLAN_MODE_CONTRACT_MARKER,
	splitModeSensitivePrompt,
	splitSystemPromptAtMarker,
} from "./system-prompt-prefix"

function buildPrompt(mode: "plan" | "act"): string {
	return buildClineSystemPrompt({
		ide: "VS Code",
		mode,
		platform: "win32",
		workspaceRoot: "c:/workspace",
		workspaceName: "workspace",
		rules: "Follow the repo conventions.",
	})
}

describe("splitSystemPromptAtMarker", () => {
	it("splits at the first marker occurrence, keeping it in the suffix", () => {
		const split = splitSystemPromptAtMarker("alpha\nbeta\n# Plan Mode\ncontract", "# Plan Mode")
		expect(split.prefix).toBe("alpha\nbeta\n")
		expect(split.suffix).toBe("# Plan Mode\ncontract")
		expect(split.prefix + split.suffix).toBe("alpha\nbeta\n# Plan Mode\ncontract")
		expect(split.prefixRatio).toBeGreaterThan(0.3)
		expect(split.prefixRatio).toBeLessThan(0.7)
	})

	it("returns the whole prompt as prefix when the marker is absent", () => {
		const split = splitSystemPromptAtMarker("no marker here", "# Plan Mode")
		expect(split.prefix).toBe("no marker here")
		expect(split.suffix).toBe("")
		expect(split.prefixRatio).toBe(1)
	})
})

describe("splitModeSensitivePrompt", () => {
	it("act mode has no mode-dependent suffix", () => {
		const prompt = buildPrompt("act")
		const split = splitModeSensitivePrompt(prompt, "act")
		expect(split.prefix).toBe(prompt)
		expect(split.suffix).toBe("")
	})

	it("plan mode splits at the plan-mode contract", () => {
		const prompt = buildPrompt("plan")
		const split = splitModeSensitivePrompt(prompt, "plan")
		expect(split.suffix.startsWith(PLAN_MODE_CONTRACT_MARKER)).toBe(true)
		expect(split.suffix.length).toBeGreaterThan(0)
	})
})

describe("plan/act shared prefix (prompt caching thesis)", () => {
	it("the plan-mode prompt is the act-mode prompt plus a small tail", () => {
		// THE core claim of the V14 §3.3 optimization: mode switching only
		// appends a tail. The plan-mode split prefix equals the act-mode prompt
		// up to trailing whitespace, i.e. plan mode = act + contract tail.
		const actPrompt = buildPrompt("act")
		const planPrompt = buildPrompt("plan")
		const planSplit = splitModeSensitivePrompt(planPrompt, "plan")
		expect(planSplit.prefix.trimEnd()).toBe(actPrompt.trimEnd())
	})

	it("the shared prefix covers the overwhelming majority of the prompt", () => {
		const ratio = measureSharedPrefixRatio(buildPrompt("plan"), buildPrompt("act"))
		// plan-mode contract is a small tail; ≥ 85% prefix hit-rate target.
		expect(ratio).toBeGreaterThan(0.85)
	})
})

describe("measureSharedPrefixRatio / commonPrefixLength", () => {
	it("computes the longest common prefix", () => {
		expect(commonPrefixLength("abcdef", "abcxyz")).toBe(3)
		expect(commonPrefixLength("abc", "abc")).toBe(3)
		expect(commonPrefixLength("abc", "")).toBe(0)
	})

	it("ratio is 1 when one string is a prefix of the other", () => {
		expect(measureSharedPrefixRatio("abcdef", "abc")).toBe(1)
		expect(measureSharedPrefixRatio("abc", "abcdef")).toBe(1)
	})

	it("ratio is 0 for disjoint strings", () => {
		expect(measureSharedPrefixRatio("xyz", "abc")).toBe(0)
	})
})

describe("findToolDelta", () => {
	it("detects the plan-only switch_to_act_mode tool", () => {
		const planTools = [{ name: "read_file" }, { name: "run_commands" }, { name: "switch_to_act_mode" }]
		const actTools = [{ name: "read_file" }, { name: "run_commands" }]
		expect(findToolDelta(planTools, actTools)).toEqual(["switch_to_act_mode"])
		expect(findToolDelta(actTools, planTools)).toEqual([])
	})

	it("returns empty for identical lists", () => {
		expect(findToolDelta([{ name: "a" }], [{ name: "a" }])).toEqual([])
	})
})
