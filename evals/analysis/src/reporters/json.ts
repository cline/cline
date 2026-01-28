/**
 * JSON reporter for Cline analysis results
 *
 * Outputs structured JSON with schema versioning for:
 * - CI integration (baseline diffing, regression detection)
 * - Programmatic analysis
 * - Data archival
 */

import type { AnalysisOutputV1 } from "../schemas"

export class JsonReporter {
	/**
	 * Generate JSON report from analysis output
	 *
	 * @param output Analysis output (already structured)
	 * @param pretty Whether to pretty-print the JSON
	 * @returns JSON string
	 */
	generate(output: AnalysisOutputV1, pretty = true): string {
		return JSON.stringify(output, null, pretty ? 2 : undefined)
	}

	/**
	 * Validate that output conforms to AnalysisOutputV1 schema
	 *
	 * @param output Analysis output to validate
	 * @throws Error if schema validation fails
	 */
	validate(output: any): asserts output is AnalysisOutputV1 {
		if (output.schema_version !== "1.0") {
			throw new Error(`Unsupported schema version: ${output.schema_version}`)
		}

		// Basic structure validation
		const required = ["metadata", "summary", "tasks", "failures"]
		for (const field of required) {
			if (!(field in output)) {
				throw new Error(`Missing required field: ${field}`)
			}
		}

		// Validate metadata
		if (!output.metadata.generated_at || !output.metadata.job_id || !output.metadata.model) {
			throw new Error("Invalid metadata: missing required fields")
		}

		// Validate summary
		if (typeof output.summary.total_tasks !== "number") {
			throw new Error("Invalid summary: total_tasks must be a number")
		}

		// Validate tasks array
		if (!Array.isArray(output.tasks)) {
			throw new Error("Invalid tasks: must be an array")
		}
	}

	/**
	 * Generate a minimal JSON report (without full logs and excerpts)
	 *
	 * Useful for CI artifacts where space is limited
	 *
	 * @param output Analysis output
	 * @returns Minified JSON string
	 */
	generateMinimal(output: AnalysisOutputV1): string {
		const minimal = {
			schema_version: output.schema_version,
			metadata: {
				job_id: output.metadata.job_id,
				model: output.metadata.model,
				generated_at: output.metadata.generated_at,
			},
			summary: output.summary,
			tasks: output.tasks.map((task) => ({
				task_id: task.task_id,
				task_name: task.task_name,
				status: task.status,
				metrics: task.metrics,
				total_cost_usd: task.total_cost_usd,
				avg_duration_sec: task.avg_duration_sec,
			})),
			failures: {
				by_category: output.failures.by_category,
				by_pattern: output.failures.by_pattern.map((p) => ({
					name: p.name,
					count: p.count,
					issue_url: p.issue_url,
				})),
			},
		}

		return JSON.stringify(minimal, null, 2)
	}
}
