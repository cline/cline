import { describe, expect, it } from "vitest"
import { MetricsCalculator } from "../metrics"

describe("MetricsCalculator", () => {
	const calc = new MetricsCalculator()

	describe("pass@k (solution finding)", () => {
		it("calculates 100% when at least k trials pass", () => {
			expect(calc.passAtK([true, true, true], 1)).toBe(1.0)
			expect(calc.passAtK([true, true, false], 1)).toBe(1.0)
			expect(calc.passAtK([true, true, true], 3)).toBe(1.0)
		})

		it("calculates 0% when fewer than k trials pass", () => {
			expect(calc.passAtK([false, false, false], 1)).toBe(0.0)
		})

		it("calculates correct probability for mixed results", () => {
			// With n=3, c=2, k=2: 1 - C(1,2)/C(3,2) = 1 - 0/3 = 1.0
			expect(calc.passAtK([true, true, false], 2)).toBe(1.0)

			// With n=3, c=1, k=2: 1 - C(2,2)/C(3,2) = 1 - 1/3 = 2/3
			expect(calc.passAtK([true, false, false], 2)).toBeCloseTo(0.6667, 4)
		})

		it("throws error when k > n", () => {
			expect(() => calc.passAtK([true, false], 3)).toThrow()
		})

		it("handles k=1 correctly (most common case)", () => {
			expect(calc.passAtK([true, false, false], 1)).toBe(1.0)
			expect(calc.passAtK([false, false, false], 1)).toBe(0.0)
		})

		it("handles all-pass scenarios", () => {
			expect(calc.passAtK([true, true, true, true, true], 3)).toBe(1.0)
			expect(calc.passAtK([true, true, true, true, true], 5)).toBe(1.0)
		})

		it("handles all-fail scenarios", () => {
			expect(calc.passAtK([false, false, false], 1)).toBe(0.0)
			expect(calc.passAtK([false, false, false], 3)).toBe(0.0)
		})
	})

	describe("pass^k (reliability)", () => {
		it("calculates 100% when all k trials must and do pass", () => {
			expect(calc.passCaretK([true, true, true], 3)).toBe(1.0)
			expect(calc.passCaretK([true, true, true, true], 3)).toBeCloseTo(1.0, 4)
		})

		it("calculates 0% when fewer than k trials pass", () => {
			expect(calc.passCaretK([true, true, false], 3)).toBe(0.0)
			expect(calc.passCaretK([true, false, false], 2)).toBe(0.0)
			expect(calc.passCaretK([false, false, false], 1)).toBe(0.0)
		})

		it("calculates correct probability for sufficient passes", () => {
			// With n=4, c=3, k=2: C(3,2)/C(4,2) = 3/6 = 0.5
			expect(calc.passCaretK([true, true, true, false], 2)).toBeCloseTo(0.5, 4)

			// With n=5, c=3, k=2: C(3,2)/C(5,2) = 3/10 = 0.3
			expect(calc.passCaretK([true, true, true, false, false], 2)).toBeCloseTo(0.3, 4)
		})

		it("throws error when k > n", () => {
			expect(() => calc.passCaretK([true, false], 3)).toThrow()
		})

		it("diverges from pass@k as trials increase", () => {
			const trials = [true, true, false, false, false]

			// pass@k increases (eventually finds solution)
			const passAt1 = calc.passAtK(trials, 1)
			const passAt3 = calc.passAtK(trials, 3)
			expect(passAt3).toBeGreaterThanOrEqual(passAt1)

			// pass^k decreases (reliability drops)
			const passCaret1 = calc.passCaretK(trials, 1)
			const passCaret3 = calc.passCaretK(trials, 3)
			expect(passCaret3).toBeLessThanOrEqual(passCaret1)
		})
	})

	describe("flakinessScore (variance)", () => {
		it("returns 0 for all-pass scenarios", () => {
			expect(calc.flakinessScore([true, true, true])).toBe(0)
		})

		it("returns 0 for all-fail scenarios", () => {
			expect(calc.flakinessScore([false, false, false])).toBe(0)
		})

		it("returns 1 for maximum variance (50% pass rate)", () => {
			expect(calc.flakinessScore([true, false])).toBe(1)
			expect(calc.flakinessScore([true, true, false, false])).toBe(1)
		})

		it("returns values between 0 and 1 for partial variance", () => {
			const score1 = calc.flakinessScore([true, true, true, false])
			expect(score1).toBeGreaterThan(0)
			expect(score1).toBeLessThan(1)

			const score2 = calc.flakinessScore([true, false, false, false])
			expect(score2).toBeGreaterThan(0)
			expect(score2).toBeLessThan(1)
		})

		it("symmetric around 50% pass rate", () => {
			const score25 = calc.flakinessScore([true, false, false, false])
			const score75 = calc.flakinessScore([true, true, true, false])
			expect(score25).toBeCloseTo(score75, 4)
		})

		it("higher variance for rates closer to 50%", () => {
			const score25 = calc.flakinessScore([true, false, false, false])
			const score50 = calc.flakinessScore([true, true, false, false])
			expect(score50).toBeGreaterThan(score25)
		})
	})

	describe("binomial coefficient", () => {
		it("calculates C(n, 0) = 1", () => {
			expect(calc["binomial"](5, 0)).toBe(1)
		})

		it("calculates C(n, n) = 1", () => {
			expect(calc["binomial"](5, 5)).toBe(1)
		})

		it("calculates C(n, 1) = n", () => {
			expect(calc["binomial"](5, 1)).toBe(5)
		})

		it("calculates C(n, k) correctly", () => {
			expect(calc["binomial"](5, 2)).toBe(10)
			expect(calc["binomial"](6, 3)).toBe(20)
			expect(calc["binomial"](10, 3)).toBe(120)
		})

		it("returns 0 when k > n", () => {
			expect(calc["binomial"](3, 5)).toBe(0)
		})

		it("optimizes by using smaller k", () => {
			// C(10, 8) = C(10, 2) = 45
			expect(calc["binomial"](10, 8)).toBe(45)
			expect(calc["binomial"](10, 2)).toBe(45)
		})
	})

	describe("calculateTaskMetrics", () => {
		it("calculates all metrics for 3 trials", () => {
			const metrics = calc.calculateTaskMetrics([true, true, false])

			expect(metrics.passAt1).toBe(1.0)
			expect(metrics.passAt3).toBeGreaterThan(0)
			expect(metrics.passCaret3).toBe(0.0)
			expect(metrics.flakinessScore).toBeGreaterThan(0)
		})

		it("calculates all metrics for perfect pass", () => {
			const metrics = calc.calculateTaskMetrics([true, true, true])

			expect(metrics.passAt1).toBe(1.0)
			expect(metrics.passAt3).toBe(1.0)
			expect(metrics.passCaret3).toBe(1.0)
			expect(metrics.flakinessScore).toBe(0)
		})

		it("calculates all metrics for perfect fail", () => {
			const metrics = calc.calculateTaskMetrics([false, false, false])

			expect(metrics.passAt1).toBe(0.0)
			expect(metrics.passAt3).toBe(0.0)
			expect(metrics.passCaret3).toBe(0.0)
			expect(metrics.flakinessScore).toBe(0)
		})

		it("throws error for empty trials", () => {
			expect(() => calc.calculateTaskMetrics([])).toThrow()
		})

		it("handles fewer than 3 trials gracefully", () => {
			const metrics = calc.calculateTaskMetrics([true, false])

			expect(metrics.passAt1).toBe(1.0)
			expect(metrics.passAt3).toBe(0) // Not enough trials
			expect(metrics.passCaret3).toBe(0)
			expect(metrics.flakinessScore).toBe(1)
		})
	})

	describe("getTaskStatus", () => {
		it("returns 'pass' when all trials pass", () => {
			expect(calc.getTaskStatus([true, true, true])).toBe("pass")
		})

		it("returns 'fail' when all trials fail", () => {
			expect(calc.getTaskStatus([false, false, false])).toBe("fail")
		})

		it("returns 'flaky' when some trials pass and some fail", () => {
			expect(calc.getTaskStatus([true, false, false])).toBe("flaky")
			expect(calc.getTaskStatus([true, true, false])).toBe("flaky")
		})

		it("handles single trial", () => {
			expect(calc.getTaskStatus([true])).toBe("pass")
			expect(calc.getTaskStatus([false])).toBe("fail")
		})
	})

	describe("Real-world scenarios", () => {
		it("handles typical cline-bench results", () => {
			// Scenario: Task passed 2/3 times
			const trials = [true, true, false]
			const metrics = calc.calculateTaskMetrics(trials)

			expect(metrics.passAt1).toBe(1.0) // Found solution
			expect(metrics.passAt3).toBeGreaterThan(0.5) // Likely to solve
			expect(metrics.passCaret3).toBe(0) // Not reliable
			expect(metrics.flakinessScore).toBeGreaterThan(0) // Has variance
			expect(calc.getTaskStatus(trials)).toBe("flaky")
		})

		it("handles consistent success", () => {
			const trials = [true, true, true]
			const metrics = calc.calculateTaskMetrics(trials)

			expect(metrics.passAt1).toBe(1.0)
			expect(metrics.passAt3).toBe(1.0)
			expect(metrics.passCaret3).toBe(1.0)
			expect(metrics.flakinessScore).toBe(0)
			expect(calc.getTaskStatus(trials)).toBe("pass")
		})

		it("handles consistent failure", () => {
			const trials = [false, false, false]
			const metrics = calc.calculateTaskMetrics(trials)

			expect(metrics.passAt1).toBe(0)
			expect(metrics.passAt3).toBe(0)
			expect(metrics.passCaret3).toBe(0)
			expect(metrics.flakinessScore).toBe(0)
			expect(calc.getTaskStatus(trials)).toBe("fail")
		})
	})
})
