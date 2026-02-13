#!/usr/bin/env node

/**
 * Cline Analysis Framework CLI
 *
 * Commands:
 * - analyze: Parse Harbor job output and generate reports
 * - compare: Compare baseline vs current results for regression detection
 */

import chalk from "chalk"
import { Command } from "commander"
import * as fs from "fs"
import { HarborParser } from "./parsers"
import { JsonReporter, MarkdownReporter } from "./reporters"
import type { AnalysisOutputV1, ComparisonResult } from "./schemas"

const program = new Command()

program.name("cline-analysis").description("Analysis framework for Cline evaluations").version("1.0.0")

// Analyze command
program
	.command("analyze <job-dir>")
	.description("Parse Harbor job output and generate analysis report")
	.option("-f, --format <format>", "Output format: markdown, json, or minimal", "markdown")
	.option("-o, --output <file>", "Write report to file (default: stdout)")
	.option("--no-color", "Disable colored output")
	.action(async (jobDir: string, options: any) => {
		try {
			// Validate job directory
			if (!fs.existsSync(jobDir)) {
				console.error(chalk.red(`Error: Job directory not found: ${jobDir}`))
				process.exit(1)
			}

			console.error(chalk.blue(`Analyzing Harbor job: ${jobDir}`))

			// Parse Harbor output
			const parser = new HarborParser()
			const analysis = parser.parseJob(jobDir)

			// Generate report
			let report: string

			if (options.format === "json") {
				const jsonReporter = new JsonReporter()
				report = jsonReporter.generate(analysis, true)
			} else if (options.format === "minimal") {
				const jsonReporter = new JsonReporter()
				report = jsonReporter.generateMinimal(analysis)
			} else {
				const markdownReporter = new MarkdownReporter()
				report = markdownReporter.generate(analysis, options.color)
			}

			// Output report
			if (options.output) {
				fs.writeFileSync(options.output, report)
				console.error(chalk.green(`✓ Report written to: ${options.output}`))

				// Also write full JSON for future reference
				if (options.format === "markdown") {
					const jsonPath = options.output.replace(/\.md$/, ".json")
					const jsonReporter = new JsonReporter()
					fs.writeFileSync(jsonPath, jsonReporter.generate(analysis, true))
					console.error(chalk.gray(`  (Full JSON saved to: ${jsonPath})`))
				}
			} else {
				console.log(report)
			}

			// Summary on stderr
			const markdownReporter = new MarkdownReporter()
			const summary = markdownReporter.generateCompactSummary(analysis)
			console.error("\n" + chalk.bold("Summary:"))
			console.error(summary)
		} catch (error) {
			console.error(chalk.red("Error during analysis:"))
			console.error(error)
			process.exit(1)
		}
	})

// Compare command
program
	.command("compare <baseline> <current>")
	.description("Compare baseline and current analysis results")
	.option("-t, --threshold <number>", "Regression threshold (percentage points)", "10")
	.option("--no-color", "Disable colored output")
	.action(async (baselinePath: string, currentPath: string, options: any) => {
		try {
			// Load both analysis outputs
			if (!fs.existsSync(baselinePath)) {
				console.error(chalk.red(`Error: Baseline file not found: ${baselinePath}`))
				process.exit(1)
			}

			if (!fs.existsSync(currentPath)) {
				console.error(chalk.red(`Error: Current file not found: ${currentPath}`))
				process.exit(1)
			}

			const baseline: AnalysisOutputV1 = JSON.parse(fs.readFileSync(baselinePath, "utf-8"))
			const current: AnalysisOutputV1 = JSON.parse(fs.readFileSync(currentPath, "utf-8"))

			const threshold = parseFloat(options.threshold)

			// Compare results
			const comparison = compareAnalyses(baseline, current, threshold)

			// Display comparison
			displayComparison(comparison, options.color)

			// Exit with error if regression detected
			if (comparison.regression_detected) {
				console.error(chalk.red("\n✗ Regression detected! See details above."))
				process.exit(1)
			} else {
				console.error(chalk.green("\n✓ No significant regression detected."))
				process.exit(0)
			}
		} catch (error) {
			console.error(chalk.red("Error during comparison:"))
			console.error(error)
			process.exit(1)
		}
	})

program.parse()

/**
 * Compare two analysis outputs for regression detection
 */
function compareAnalyses(baseline: AnalysisOutputV1, current: AnalysisOutputV1, threshold: number): ComparisonResult {
	const delta = {
		pass_at_1: (current.summary.pass_at_1 - baseline.summary.pass_at_1) * 100,
		pass_at_3: (current.summary.pass_at_3 - baseline.summary.pass_at_3) * 100,
		pass_caret_3: (current.summary.pass_caret_3 - baseline.summary.pass_caret_3) * 100,
		cost_usd: current.summary.total_cost_usd - baseline.summary.total_cost_usd,
		duration_sec: current.summary.total_duration_sec - baseline.summary.total_duration_sec,
	}

	// Detect regression (drop in pass rates exceeding threshold)
	const regression_detected = delta.pass_at_1 < -threshold || delta.pass_at_3 < -threshold

	// Find tasks that regressed or improved
	const tasks_regressed: string[] = []
	const tasks_improved: string[] = []

	const baselineTaskMap = new Map(baseline.tasks.map((t) => [t.task_id, t]))

	for (const currentTask of current.tasks) {
		const baselineTask = baselineTaskMap.get(currentTask.task_id)
		if (!baselineTask) {
			continue
		}

		const taskDelta = (currentTask.metrics.pass_at_3 - baselineTask.metrics.pass_at_3) * 100

		if (taskDelta < -threshold) {
			tasks_regressed.push(currentTask.task_name)
		} else if (taskDelta > threshold) {
			tasks_improved.push(currentTask.task_name)
		}
	}

	return {
		baseline: baseline.summary,
		current: current.summary,
		delta,
		regression_detected,
		tasks_regressed,
		tasks_improved,
	}
}

/**
 * Display comparison results with color coding
 */
function displayComparison(comparison: ComparisonResult, useColor: boolean): void {
	const separator = "━".repeat(79)

	console.log(useColor ? chalk.bold(separator) : separator)
	console.log(useColor ? chalk.bold.cyan("Baseline vs Current Comparison") : "Baseline vs Current Comparison")
	console.log(useColor ? chalk.bold(separator) : separator)
	console.log("")

	// Pass rate changes
	console.log(useColor ? chalk.bold("Pass Rate Changes:") : "Pass Rate Changes:")
	console.log(`  pass@1: ${formatDelta(comparison.delta.pass_at_1, useColor)} percentage points`)
	console.log(`  pass@3: ${formatDelta(comparison.delta.pass_at_3, useColor)} percentage points`)
	console.log(`  pass^3: ${formatDelta(comparison.delta.pass_caret_3, useColor)} percentage points`)
	console.log("")

	// Cost and duration changes
	console.log(useColor ? chalk.bold("Resource Changes:") : "Resource Changes:")
	console.log(`  Cost: ${formatDelta(comparison.delta.cost_usd, useColor, true)} USD`)
	console.log(`  Duration: ${formatDelta(comparison.delta.duration_sec, useColor)} seconds`)
	console.log("")

	// Tasks regressed
	if (comparison.tasks_regressed.length > 0) {
		console.log(useColor ? chalk.bold.red("Tasks Regressed:") : "Tasks Regressed:")
		for (const task of comparison.tasks_regressed) {
			console.log(`  • ${task}`)
		}
		console.log("")
	}

	// Tasks improved
	if (comparison.tasks_improved.length > 0) {
		console.log(useColor ? chalk.bold.green("Tasks Improved:") : "Tasks Improved:")
		for (const task of comparison.tasks_improved) {
			console.log(`  • ${task}`)
		}
		console.log("")
	}
}

/**
 * Format delta value with color coding
 */
function formatDelta(value: number, useColor: boolean, invertSign = false): string {
	const sign = invertSign ? -Math.sign(value) : Math.sign(value)
	const absValue = Math.abs(value).toFixed(2)
	const signStr = sign > 0 ? "+" : sign < 0 ? "-" : " "

	if (!useColor) {
		return `${signStr}${absValue}`
	}

	if (sign > 0) {
		return chalk.green(`${signStr}${absValue}`)
	}
	if (sign < 0) {
		return chalk.red(`${signStr}${absValue}`)
	}
	return chalk.gray(`${signStr}${absValue}`)
}
