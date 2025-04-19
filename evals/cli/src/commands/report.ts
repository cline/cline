import * as fs from "fs"
import * as path from "path"
import chalk from "chalk"
import ora from "ora"
import { ResultsDatabase } from "../db"
import { generateMarkdownReport } from "../utils/markdown"

interface ReportOptions {
	format?: "json" | "markdown"
	output?: string
}

/**
 * Handler for the report command
 * @param options Command options
 */
export async function reportHandler(options: ReportOptions): Promise<void> {
	const format = options.format || "markdown"
	const db = new ResultsDatabase()

	try {
		const spinner = ora("Generating report...").start()

		// Get all runs
		const runs = db.getRuns()

		console.log(chalk.blue(`Found ${runs.length} evaluation runs`))

		if (runs.length === 0) {
			spinner.fail("No evaluation runs found")
			return
		}

		// Generate summary report
		const summary = {
			runs: runs.length,
			models: [...new Set(runs.map((run) => run.model))],
			benchmarks: [...new Set(runs.map((run) => run.benchmark))],
			tasks: 0,
			successRate: 0,
			averageTokens: 0,
			averageCost: 0,
			averageDuration: 0,
			totalToolCalls: 0,
			totalToolFailures: 0,
			toolSuccessRate: 0,
			toolUsage: {} as Record<string, { calls: number; failures: number }>,
		}

		let totalTasks = 0
		let successfulTasks = 0
		let totalTokens = 0
		let totalCost = 0
		let totalDuration = 0
		let totalToolCalls = 0
		let totalToolFailures = 0

		for (const run of runs) {
			const tasks = db.getRunTasks(run.id)
			totalTasks += tasks.length

			for (const task of tasks) {
				if (task.success) {
					successfulTasks++
				}

				const metrics = db.getTaskMetrics(task.id)

				const tokensIn = metrics.find((m) => m.name === "tokensIn")?.value || 0
				const tokensOut = metrics.find((m) => m.name === "tokensOut")?.value || 0
				totalTokens += tokensIn + tokensOut

				totalCost += metrics.find((m) => m.name === "cost")?.value || 0
				totalDuration += metrics.find((m) => m.name === "duration")?.value || 0

				// Collect tool call metrics
				totalToolCalls += task.total_tool_calls || 0
				totalToolFailures += task.total_tool_failures || 0

				// Get detailed tool usage
				const toolCalls = db.getTaskToolCalls(task.id)

				for (const toolCall of toolCalls) {
					if (!summary.toolUsage[toolCall.tool_name]) {
						summary.toolUsage[toolCall.tool_name] = {
							calls: 0,
							failures: 0,
						}
					}

					summary.toolUsage[toolCall.tool_name].calls += toolCall.call_count
					summary.toolUsage[toolCall.tool_name].failures += toolCall.failure_count
				}
			}
		}

		// Calculate tool success rate
		summary.totalToolCalls = totalToolCalls
		summary.totalToolFailures = totalToolFailures
		summary.toolSuccessRate = totalToolCalls > 0 ? 1 - totalToolFailures / totalToolCalls : 1.0

		summary.tasks = totalTasks
		summary.successRate = totalTasks > 0 ? successfulTasks / totalTasks : 0
		summary.averageTokens = totalTasks > 0 ? totalTokens / totalTasks : 0
		summary.averageCost = totalTasks > 0 ? totalCost / totalTasks : 0
		summary.averageDuration = totalTasks > 0 ? totalDuration / totalTasks : 0

		// Generate benchmark-specific reports
		const benchmarkReports: Record<string, any> = {}

		for (const benchmark of summary.benchmarks) {
			const benchmarkRuns = runs.filter((run) => run.benchmark === benchmark)
			const benchmarkSummary = {
				runs: benchmarkRuns.length,
				models: [...new Set(benchmarkRuns.map((run) => run.model))],
				tasks: 0,
				successRate: 0,
				averageTokens: 0,
				averageCost: 0,
				averageDuration: 0,
			}

			let benchmarkTasks = 0
			let benchmarkSuccessfulTasks = 0
			let benchmarkTotalTokens = 0
			let benchmarkTotalCost = 0
			let benchmarkTotalDuration = 0

			for (const run of benchmarkRuns) {
				const tasks = db.getRunTasks(run.id)
				benchmarkTasks += tasks.length

				for (const task of tasks) {
					if (task.success) {
						benchmarkSuccessfulTasks++
					}

					const metrics = db.getTaskMetrics(task.id)

					const tokensIn = metrics.find((m) => m.name === "tokensIn")?.value || 0
					const tokensOut = metrics.find((m) => m.name === "tokensOut")?.value || 0
					benchmarkTotalTokens += tokensIn + tokensOut

					benchmarkTotalCost += metrics.find((m) => m.name === "cost")?.value || 0
					benchmarkTotalDuration += metrics.find((m) => m.name === "duration")?.value || 0
				}
			}

			benchmarkSummary.tasks = benchmarkTasks
			benchmarkSummary.successRate = benchmarkTasks > 0 ? benchmarkSuccessfulTasks / benchmarkTasks : 0
			benchmarkSummary.averageTokens = benchmarkTasks > 0 ? benchmarkTotalTokens / benchmarkTasks : 0
			benchmarkSummary.averageCost = benchmarkTasks > 0 ? benchmarkTotalCost / benchmarkTasks : 0
			benchmarkSummary.averageDuration = benchmarkTasks > 0 ? benchmarkTotalDuration / benchmarkTasks : 0

			benchmarkReports[benchmark] = benchmarkSummary
		}

		// Generate model-specific reports
		const modelReports: Record<string, any> = {}

		for (const model of summary.models) {
			const modelRuns = runs.filter((run) => run.model === model)
			const modelSummary = {
				runs: modelRuns.length,
				benchmarks: [...new Set(modelRuns.map((run) => run.benchmark))],
				tasks: 0,
				successRate: 0,
				averageTokens: 0,
				averageCost: 0,
				averageDuration: 0,
			}

			let modelTasks = 0
			let modelSuccessfulTasks = 0
			let modelTotalTokens = 0
			let modelTotalCost = 0
			let modelTotalDuration = 0

			for (const run of modelRuns) {
				const tasks = db.getRunTasks(run.id)
				modelTasks += tasks.length

				for (const task of tasks) {
					if (task.success) {
						modelSuccessfulTasks++
					}

					const metrics = db.getTaskMetrics(task.id)

					const tokensIn = metrics.find((m) => m.name === "tokensIn")?.value || 0
					const tokensOut = metrics.find((m) => m.name === "tokensOut")?.value || 0
					modelTotalTokens += tokensIn + tokensOut

					modelTotalCost += metrics.find((m) => m.name === "cost")?.value || 0
					modelTotalDuration += metrics.find((m) => m.name === "duration")?.value || 0
				}
			}

			modelSummary.tasks = modelTasks
			modelSummary.successRate = modelTasks > 0 ? modelSuccessfulTasks / modelTasks : 0
			modelSummary.averageTokens = modelTasks > 0 ? modelTotalTokens / modelTasks : 0
			modelSummary.averageCost = modelTasks > 0 ? modelTotalCost / modelTasks : 0
			modelSummary.averageDuration = modelTasks > 0 ? modelTotalDuration / modelTasks : 0

			modelReports[model] = modelSummary
		}

		// Save reports
		const reportDir = path.join(path.resolve(__dirname, "../../../"), "results", "reports")
		fs.mkdirSync(reportDir, { recursive: true })

		const timestamp = new Date().toISOString().replace(/:/g, "-")

		if (format === "json") {
			// Save JSON reports
			fs.writeFileSync(path.join(reportDir, `summary-${timestamp}.json`), JSON.stringify(summary, null, 2))

			fs.writeFileSync(path.join(reportDir, `benchmarks-${timestamp}.json`), JSON.stringify(benchmarkReports, null, 2))

			fs.writeFileSync(path.join(reportDir, `models-${timestamp}.json`), JSON.stringify(modelReports, null, 2))

			spinner.succeed(`JSON reports generated in ${reportDir}`)
		} else {
			// Generate markdown report
			const outputPath = options.output || path.join(reportDir, `report-${timestamp}.md`)

			generateMarkdownReport(summary, benchmarkReports, modelReports, outputPath)

			spinner.succeed(`Markdown report generated at ${outputPath}`)
		}
	} catch (error: any) {
		console.error(chalk.red(`Error generating report: ${error.message}`))
		console.error(error.stack)
	} finally {
		db.close()
	}
}
