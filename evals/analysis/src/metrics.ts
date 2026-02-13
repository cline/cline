/**
 * Metrics calculation for nondeterministic AI testing
 *
 * Implements:
 * - pass@k: P(at least 1 of k trials passes) - solution finding capability
 * - pass^k: P(all k trials pass) - reliability measure
 * - Flakiness score: Entropy-based variance measurement
 *
 * References:
 * - HumanEval paper: https://arxiv.org/abs/2107.03374
 * - pass@k methodology: https://github.com/openai/human-eval
 */

export class MetricsCalculator {
	/**
	 * Calculate pass@k: Probability that at least 1 of k trials succeeds
	 *
	 * Formula: 1 - C(n-c, k) / C(n, k)
	 * where n = total trials, c = number of passes, k = sample size
	 *
	 * Interpretation: "Can this model solve the problem?"
	 *
	 * @param trials Array of boolean trial results (true = pass, false = fail)
	 * @param k Number of trials to sample
	 * @returns Probability [0, 1]
	 */
	passAtK(trials: boolean[], k: number): number {
		const n = trials.length
		const c = trials.filter(Boolean).length

		if (n < k) {
			throw new Error(`Cannot calculate pass@${k} with only ${n} trials`)
		}

		// If we have at least k passes, probability is 100%
		if (c >= k) {
			return 1.0
		}

		// Calculate: 1 - C(n-c, k) / C(n, k)
		const numerator = this.binomial(n - c, k)
		const denominator = this.binomial(n, k)

		return 1 - numerator / denominator
	}

	/**
	 * Calculate pass^k: Probability that ALL k trials succeed
	 *
	 * Formula: C(c, k) / C(n, k)
	 * where n = total trials, c = number of passes, k = sample size
	 *
	 * Interpretation: "Can I rely on this model?" (reliability metric)
	 *
	 * @param trials Array of boolean trial results
	 * @param k Number of trials that must all pass
	 * @returns Probability [0, 1]
	 */
	passCaretK(trials: boolean[], k: number): number {
		const n = trials.length
		const c = trials.filter(Boolean).length

		if (n < k) {
			throw new Error(`Cannot calculate pass^${k} with only ${n} trials`)
		}

		// If we have fewer than k passes, probability is 0%
		if (c < k) {
			return 0.0
		}

		// Calculate: C(c, k) / C(n, k)
		const numerator = this.binomial(c, k)
		const denominator = this.binomial(n, k)

		return numerator / denominator
	}

	/**
	 * Calculate flakiness score: Entropy-based measure of variance
	 *
	 * Formula: -p*log2(p) - (1-p)*log2(1-p)
	 * where p = pass rate
	 *
	 * Returns:
	 * - 0.0: No variance (all pass or all fail)
	 * - 1.0: Maximum variance (50% pass rate)
	 *
	 * Interpretation: How unpredictable/inconsistent is this task?
	 *
	 * @param trials Array of boolean trial results
	 * @returns Flakiness score [0, 1]
	 */
	flakinessScore(trials: boolean[]): number {
		const passRate = trials.filter(Boolean).length / trials.length

		// No variance if all pass or all fail
		if (passRate === 0 || passRate === 1) {
			return 0
		}

		// Binary entropy
		const entropy = -passRate * Math.log2(passRate) - (1 - passRate) * Math.log2(1 - passRate)

		return entropy // Already in [0, 1] range
	}

	/**
	 * Binomial coefficient C(n, k) = n! / (k! * (n-k)!)
	 *
	 * Uses iterative calculation to avoid factorial overflow
	 *
	 * @param n Total items
	 * @param k Items to choose
	 * @returns Number of ways to choose k items from n
	 */
	private binomial(n: number, k: number): number {
		if (k > n) {
			return 0
		}
		if (k === 0 || k === n) {
			return 1
		}

		// Optimize by using smaller k
		if (k > n - k) {
			k = n - k
		}

		let result = 1
		for (let i = 1; i <= k; i++) {
			result *= n - i + 1
			result /= i
		}

		return result
	}

	/**
	 * Calculate all metrics for a task's trials
	 *
	 * @param trials Array of boolean trial results
	 * @returns Object with pass@1, pass@3, pass^3, and flakiness scores
	 */
	calculateTaskMetrics(trials: boolean[]): {
		passAt1: number
		passAt3: number
		passCaret3: number
		flakinessScore: number
	} {
		if (trials.length === 0) {
			throw new Error("Cannot calculate metrics with no trials")
		}

		// Calculate pass@k and pass^k for available trials
		const passAt1 = trials.length >= 1 ? this.passAtK(trials, 1) : 0
		const passAt3 = trials.length >= 3 ? this.passAtK(trials, 3) : 0
		const passCaret3 = trials.length >= 3 ? this.passCaretK(trials, 3) : 0

		return {
			passAt1,
			passAt3,
			passCaret3,
			flakinessScore: this.flakinessScore(trials),
		}
	}

	/**
	 * Determine task status based on trial results
	 *
	 * @param trials Array of boolean trial results
	 * @returns "pass" | "fail" | "flaky"
	 */
	getTaskStatus(trials: boolean[]): "pass" | "fail" | "flaky" {
		const passCount = trials.filter(Boolean).length
		const totalCount = trials.length

		if (passCount === totalCount) {
			return "pass"
		}
		if (passCount === 0) {
			return "fail"
		}
		return "flaky"
	}
}
