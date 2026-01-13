import { expect } from "chai"
import { evaluateRuleConditionals, extractPathLikeStrings } from "../rule-conditionals"

describe("rule-conditionals", () => {
	describe("evaluateRuleConditionals(paths)", () => {
		it("treats missing paths as universal", () => {
			const res = evaluateRuleConditionals({}, { paths: [] })
			expect(res.passed).to.equal(true)
		})

		it("does not activate path-scoped rules with empty context", () => {
			const res = evaluateRuleConditionals({ paths: ["src/**"] }, { paths: [] })
			expect(res.passed).to.equal(false)
		})

		it("matches when any candidate path matches any glob", () => {
			const res = evaluateRuleConditionals({ paths: ["src/**", "apps/**"] }, { paths: ["src/index.ts"] })
			expect(res.passed).to.equal(true)
			expect(res.matchedConditions.paths).to.deep.equal(["src/**"])
		})

		it("ignores invalid paths type (fail-open)", () => {
			const res = evaluateRuleConditionals({ paths: "src/**" as any }, { paths: [] })
			expect(res.passed).to.equal(true)
		})
	})

	describe("extractPathLikeStrings", () => {
		it("extracts basic relative paths", () => {
			const res = extractPathLikeStrings("edit apps/web/src/App.tsx and packages/foo/src")
			expect(res).to.deep.equal(["apps/web/src/App.tsx", "packages/foo/src"])
		})

		it("ignores URLs", () => {
			const res = extractPathLikeStrings("see https://example.com/a/b and edit src/index.ts")
			expect(res).to.deep.equal(["src/index.ts"])
		})
	})
})
