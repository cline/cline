/**
 * Markdown reporter for Cline analysis results
 *
 * Generates human-readable reports with:
 * - Summary metrics (pass@k, cost, duration)
 * - Task-by-task results
 * - Failure analysis with issue links
 * - Terminal-friendly formatting
 */

import chalk from "chalk"
import type { AnalysisOutputV1, TaskResultV1 } from "../schemas"

export class MarkdownReporter {
	/**
	 * Generate markdown report from analysis output
	 *
	 * @param output Analysis output
	 * @param useColor Whether to use terminal colors
	 * @returns Markdown-formatted report string
	 */
	generate(output: AnalysisOutputV1, useColor = true): string {
		const sections: string[] = []

		sections.push(this.generateHeader(output, useColor))
		sections.push(this.generateSummary(output, useColor))
		sections.push(this.generateTaskResults(output, useColor))
		sections.push(this.generateFailureAnalysis(output, useColor))
		sections.push(this.generateCostPerformance(output, useColor))

		return sections.join("\n\n")
	}

	private generateHeader(output: AnalysisOutputV1, useColor: boolean): string {
		const separator = "━".repeat(79)
		const title = "Cline Bench Analysis Report"

		const lines = [
			useColor ? chalk.bold(separator) : separator,
			useColor ? chalk.bold.cyan(title) : title,
			useColor ? chalk.bold(separator) : separator,
			"",
			`Job: ${output.metadata.job_id}`,
			`Model: ${output.metadata.model}`,
			`Tasks: ${output.summary.total_tasks} | Trials per task: ${Math.round(output.summary.total_trials / output.summary.total_tasks)}`,
		]

		return lines.join("\n")
	}

	private generateSummary(output: AnalysisOutputV1, useColor: boolean): string {
		const { summary } = output
		const separator = "━".repeat(79)

		const passAt1Pct = (summary.pass_at_1 * 100).toFixed(1)
		const passAt3Pct = (summary.pass_at_3 * 100).toFixed(1)
		const passCaret3Pct = (summary.pass_caret_3 * 100).toFixed(1)

		const lines = [
			useColor ? chalk.bold(separator) : separator,
			useColor ? chalk.bold("Results Summary") : "Results Summary",
			useColor ? chalk.bold(separator) : separator,
			"",
			"Overall Metrics:",
			`  pass@1: ${passAt1Pct}%  (solution finding)`,
			`  pass@3: ${passAt3Pct}%  (with 3 attempts)`,
			`  pass^3: ${passCaret3Pct}%  (reliability - all 3 pass)`,
			"",
		]

		if (summary.flaky_task_count > 0) {
			lines.push(
				useColor
					? chalk.yellow(`Flakiness: ${summary.flaky_task_count} tasks showed variance across trials`)
					: `Flakiness: ${summary.flaky_task_count} tasks showed variance across trials`,
			)
		} else {
			lines.push("Flakiness: No variance detected (all tasks consistent)")
		}

		return lines.join("\n")
	}

	private generateTaskResults(output: AnalysisOutputV1, useColor: boolean): string {
		const separator = "━".repeat(79)

		const lines = [
			useColor ? chalk.bold(separator) : separator,
			useColor ? chalk.bold("Task Results") : "Task Results",
			useColor ? chalk.bold(separator) : separator,
			"",
		]

		for (const task of output.tasks) {
			const statusIcon = this.getStatusIcon(task, useColor)
			const passAt1Pct = (task.metrics.pass_at_1 * 100).toFixed(0)
			const passCaret3Pct = (task.metrics.pass_caret_3 * 100).toFixed(0)
			const trialPattern = this.getTrialPattern(task, useColor)
			const flakyWarning =
				task.status === "flaky" && useColor ? chalk.yellow(" ⚠️  FLAKY") : task.status === "flaky" ? " ⚠️  FLAKY" : ""

			const taskLine = `${statusIcon} ${task.task_name.padEnd(30)} | pass@1: ${passAt1Pct.padStart(3)}% | pass^3: ${passCaret3Pct.padStart(3)}% | ${trialPattern}${flakyWarning}`
			lines.push(taskLine)
		}

		return lines.join("\n")
	}

	private getStatusIcon(task: TaskResultV1, useColor: boolean): string {
		if (task.status === "pass") {
			return useColor ? chalk.green("✓") : "✓"
		}
		if (task.status === "fail") {
			return useColor ? chalk.red("✗") : "✗"
		}
		return useColor ? chalk.yellow("◐") : "◐"
	}

	private getTrialPattern(task: TaskResultV1, useColor: boolean): string {
		const pattern = task.trials
			.map((t) => {
				if (t.passed) {
					return useColor ? chalk.green("P") : "P"
				}
				return useColor ? chalk.red("F") : "F"
			})
			.join("")

		return `[${pattern}]`
	}

	private generateFailureAnalysis(output: AnalysisOutputV1, useColor: boolean): string {
		const separator = "━".repeat(79)

		const lines = [
			useColor ? chalk.bold(separator) : separator,
			useColor ? chalk.bold("Failure Analysis") : "Failure Analysis",
			useColor ? chalk.bold(separator) : separator,
			"",
		]

		// Known issues (provider bugs)
		const providerBugs = output.failures.by_pattern.filter((p) => p.issue_url)

		if (providerBugs.length > 0) {
			lines.push("Known Issues Detected:")
			for (const bug of providerBugs) {
				const line = `  • ${bug.name} (${bug.count} occurrence${bug.count > 1 ? "s" : ""}) - ${bug.issue_url}`
				lines.push(useColor ? chalk.yellow(line) : line)

				// Show first example
				if (bug.examples.length > 0) {
					const example = bug.examples[0]
					lines.push(`    Task: ${example.task_id}, Trial ${example.trial_index}`)
				}
			}
			lines.push("")
		}

		// Transient failures
		const transient = Object.entries(output.failures.by_category).filter(([cat]) =>
			["transient", "harness", "environment"].includes(cat),
		)

		if (transient.length > 0) {
			lines.push("Infrastructure/Transient Failures:")
			for (const [category, count] of transient) {
				lines.push(`  • ${category}: ${count} occurrence${count > 1 ? "s" : ""}`)
			}
			lines.push("")
		}

		// Task failures (model couldn't solve)
		const taskFailures = output.tasks.filter((t) => t.status === "fail")
		if (taskFailures.length > 0) {
			lines.push("Task Failures (Model couldn't solve):")
			for (const task of taskFailures) {
				const allFailed = task.trials.every((t) => !t.passed)
				if (allFailed) {
					lines.push(`  • ${task.task_name}: All ${task.trials.length} trials failed verification tests`)
				}
			}
		}

		return lines.join("\n")
	}

	private generateCostPerformance(output: AnalysisOutputV1, useColor: boolean): string {
		const separator = "━".repeat(79)

		const avgCostPerTask = output.summary.total_cost_usd / output.summary.total_tasks
		const avgDurationPerTask = output.summary.total_duration_sec / output.summary.total_tasks

		const formattedDuration = this.formatDuration(output.summary.total_duration_sec)
		const avgFormattedDuration = this.formatDuration(avgDurationPerTask)

		const lines = [
			useColor ? chalk.bold(separator) : separator,
			useColor ? chalk.bold("Cost & Performance") : "Cost & Performance",
			useColor ? chalk.bold(separator) : separator,
			"",
			`Total Cost: $${output.summary.total_cost_usd.toFixed(2)}`,
			`Avg per task: $${avgCostPerTask.toFixed(2)}`,
			`Total Duration: ${formattedDuration}`,
			`Avg per task: ${avgFormattedDuration}`,
			"",
			`Full report saved to: ${output.metadata.job_id}/analysis_report.md`,
		]

		return lines.join("\n")
	}

	private formatDuration(seconds: number): string {
		if (seconds < 60) {
			return `${seconds.toFixed(0)}s`
		}
		const minutes = Math.floor(seconds / 60)
		const secs = Math.floor(seconds % 60)
		return `${minutes}m ${secs}s`
	}

	/**
	 * Generate a compact summary (for CI output)
	 */
	generateCompactSummary(output: AnalysisOutputV1): string {
		const passAt1 = (output.summary.pass_at_1 * 100).toFixed(1)
		const passAt3 = (output.summary.pass_at_3 * 100).toFixed(1)
		const cost = output.summary.total_cost_usd.toFixed(2)

		return [
			`✓ pass@1: ${passAt1}% | pass@3: ${passAt3}%`,
			`  Cost: $${cost} | Tasks: ${output.summary.total_tasks}`,
			`  Flaky: ${output.summary.flaky_task_count}`,
		].join("\n")
	}
}
