import { before, describe, it } from "mocha"
import "should"
import { offlineScenarios } from "../scenarios"
import { formatScorecard, runScorecard, type Scorecard } from "../scorecard"

describe("EVAL: harness resilience scorecard (offline)", () => {
	let card: Scorecard

	before(async () => {
		card = await runScorecard(offlineScenarios)
		// Print the human-readable scorecard so `npm run eval:harness` is a useful instrument.
		console.log("\n" + formatScorecard(card) + "\n")
	})

	it("runs every scenario", () => {
		card.total.should.equal(offlineScenarios.length)
	})

	it("passes every offline scenario (these are deterministic — any failure is a regression)", () => {
		const failures = card.categories.flatMap((c) => c.failures.map((f) => `${c.category}/${f.id}: ${f.detail ?? ""}`))
		failures.should.deepEqual([])
		card.passRate.should.equal(1)
	})

	it("covers all five resilience capability areas", () => {
		const categories = card.categories.map((c) => c.category).sort()
		categories.should.deepEqual([
			"capability-routing",
			"loop-detection",
			"mcp-json-repair",
			"resilience-nudge",
			"tool-input-repair",
		])
	})
})
