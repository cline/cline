import { describe, expect, it } from "vitest"
import { renderEnabledRulesForSystemPrompt } from "./user-instruction-rules"

function serviceWith(rules: Array<{ name: string; instructions: string; disabled?: boolean }>) {
	return {
		listRecords: <T>(type: string) =>
			(type === "rule"
				? rules.map((rule) => ({
						type: "rule",
						id: rule.name,
						filePath: `/rules/${rule.name}.md`,
						item: { ...rule, frontmatter: {} },
					}))
				: []) as unknown as Array<{ type: "rule"; id: string; filePath: string; item: T }>,
	}
}

describe("renderEnabledRulesForSystemPrompt", () => {
	it("renders enabled rules in the SDK's system-prompt shape, sorted by name", () => {
		const rendered = renderEnabledRulesForSystemPrompt(
			serviceWith([
				{ name: "zeta", instructions: "Use conventional commits." },
				{ name: "alpha", instructions: "Write in English." },
			]),
		)

		expect(rendered).toBe("\n\n# Rules\n## alpha\nWrite in English.\n\n## zeta\nUse conventional commits.")
	})

	it("drops rules disabled via frontmatter", () => {
		const rendered = renderEnabledRulesForSystemPrompt(
			serviceWith([
				{ name: "kept", instructions: "Keep me." },
				{ name: "off", instructions: "Skip me.", disabled: true },
			]),
		)

		expect(rendered).toContain("## kept")
		expect(rendered).not.toContain("Skip me.")
	})

	it("returns an empty string when nothing is enabled", () => {
		expect(renderEnabledRulesForSystemPrompt(serviceWith([]))).toBe("")
		expect(renderEnabledRulesForSystemPrompt(serviceWith([{ name: "off", instructions: "x", disabled: true }]))).toBe("")
	})
})
