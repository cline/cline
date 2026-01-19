import { expect } from "chai"
import { evaluateRuleConditionals, extractPathLikeStrings } from "../rule-conditionals"

describe("rule-conditionals", () => {
	describe("evaluateRuleConditionals(paths)", () => {
		it("treats missing paths as universal", () => {
			const res = evaluateRuleConditionals({}, { paths: [] })
			expect(res.passed).to.equal(true)
		})

		it("treats empty paths list in frontmatter as match-nothing (fail-closed)", () => {
			const res = evaluateRuleConditionals({ paths: [] }, { paths: ["src/index.ts"] })
			expect(res.passed).to.equal(false)
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

		it("extracts simple filenames with extensions (no slashes)", () => {
			const res = extractPathLikeStrings("Does foo.md exist? If not, create foo.md")
			expect(res).to.deep.equal(["foo.md"])
		})

		it("does not extract bare words without an extension", () => {
			const res = extractPathLikeStrings("Please create foo and then update bar")
			expect(res).to.deep.equal([])
		})

		it("ignores URLs", () => {
			const res = extractPathLikeStrings("see https://example.com/a/b and edit src/index.ts")
			expect(res).to.deep.equal(["src/index.ts"])
		})
	})
})
