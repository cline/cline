/**
 * Harness-resilience eval scorecard.
 *
 * A small, deterministic measurement instrument for the agent harness. Each scenario
 * exercises real harness code (tool-input repair, loop detection, capability routing,
 * resilience nudges) against a representative weak-model failure mode and reports whether
 * the harness handled it as desired. The scorecard aggregates pass-rates per category so
 * threshold-tuning and regression-tracking are data-driven rather than vibes-driven.
 *
 * The EvalScenario shape is intentionally async/Promise-friendly so a future live-model
 * runner (replaying real tasks through an API) can register scenarios against the same
 * engine and feed the same scorecard. See ./live/index.ts.
 */

export type Promisable<T> = T | Promise<T>

export interface EvalResult {
	passed: boolean
	detail?: string
}

export interface EvalScenario {
	id: string
	category: string
	description: string
	run: () => Promisable<EvalResult>
}

export interface CategoryScore {
	category: string
	passed: number
	total: number
	failures: Array<{ id: string; detail?: string }>
}

export interface Scorecard {
	total: number
	passed: number
	passRate: number
	categories: CategoryScore[]
}

export async function runScorecard(scenarios: EvalScenario[]): Promise<Scorecard> {
	const byCategory = new Map<string, CategoryScore>()

	for (const scenario of scenarios) {
		let result: EvalResult
		try {
			result = await scenario.run()
		} catch (error) {
			result = { passed: false, detail: `threw: ${error instanceof Error ? error.message : String(error)}` }
		}

		let score = byCategory.get(scenario.category)
		if (!score) {
			score = { category: scenario.category, passed: 0, total: 0, failures: [] }
			byCategory.set(scenario.category, score)
		}
		score.total++
		if (result.passed) {
			score.passed++
		} else {
			score.failures.push({ id: scenario.id, detail: result.detail })
		}
	}

	const categories = [...byCategory.values()]
	const total = categories.reduce((n, c) => n + c.total, 0)
	const passed = categories.reduce((n, c) => n + c.passed, 0)

	return {
		total,
		passed,
		passRate: total === 0 ? 1 : passed / total,
		categories,
	}
}

export function formatScorecard(card: Scorecard): string {
	const lines: string[] = []
	lines.push("=".repeat(60))
	lines.push("  HARNESS RESILIENCE SCORECARD")
	lines.push("=".repeat(60))
	for (const c of card.categories) {
		const pct = c.total === 0 ? 100 : Math.round((c.passed / c.total) * 100)
		lines.push(`  ${c.category.padEnd(24)} ${c.passed}/${c.total}  (${pct}%)`)
		for (const f of c.failures) {
			lines.push(`      ✗ ${f.id}${f.detail ? ` — ${f.detail}` : ""}`)
		}
	}
	lines.push("-".repeat(60))
	lines.push(`  TOTAL: ${card.passed}/${card.total}  (${Math.round(card.passRate * 100)}%)`)
	lines.push("=".repeat(60))
	return lines.join("\n")
}
