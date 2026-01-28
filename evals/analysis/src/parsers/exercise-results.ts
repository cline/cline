/**
 * Parser for coding exercises test results
 *
 * Parses results from polyglot coding exercises (small task benchmarks)
 *
 * TODO: Implement once coding-exercises test runner is in place
 */

import type { CodingExercisesResult } from "../schemas"

export class ExerciseResultsParser {
	/**
	 * Parse coding exercises test results
	 *
	 * @param resultsPath Path to results JSON file
	 * @returns Coding exercises result with schema version
	 */
	parseResults(resultsPath: string): CodingExercisesResult {
		// TODO: Implement parser for coding exercises results
		// Expected format from npm test -- --output-json
		throw new Error("ExerciseResultsParser.parseResults() not yet implemented")
	}
}
