/**
 * Parser for Harbor framework job output
 *
 * Parses jobs/ directory structure created by Harbor to extract:
 * - Trial results (pass/fail, duration, cost, tokens)
 * - Task groupings and metrics
 * - Failure classifications
 */

import * as fs from "fs"
import * as path from "path"
import { FailureClassifier } from "../classifier"
import { MetricsCalculator } from "../metrics"
import type {
	AnalysisMetadata,
	AnalysisOutputV1,
	AnalysisSummary,
	FailureAnalysis,
	TaskResultV1,
	TrialResultV1,
} from "../schemas"

export interface HarborParserOptions {
	patternsPath?: string
}

export class HarborParser {
	private classifier: FailureClassifier
	private metrics: MetricsCalculator

	constructor(options: HarborParserOptions = {}) {
		this.classifier = new FailureClassifier(options.patternsPath)
		this.metrics = new MetricsCalculator()
	}

	/**
	 * Parse a complete Harbor job directory
	 *
	 * @param jobDir Path to job directory (e.g., jobs/2025-01-25__10-30-00/)
	 * @returns Structured analysis output with schema version 1.0
	 */
	parseJob(jobDir: string): AnalysisOutputV1 {
		const configPath = path.join(jobDir, "config.json")
		const resultPath = path.join(jobDir, "result.json")

		if (!fs.existsSync(configPath) || !fs.existsSync(resultPath)) {
			throw new Error(`Invalid Harbor job directory: ${jobDir}`)
		}

		const config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
		const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"))

		// Find all trial directories
		const trialDirs = this.findTrialDirectories(jobDir)
		const trials = trialDirs.map((dir) => this.parseTrialDirectory(dir))

		// Group trials by task ID
		const taskResults = this.groupTrialsByTask(trials)

		// Calculate aggregate metrics
		const summary = this.calculateSummary(taskResults)

		// Analyze failures
		const failures = this.analyzeFailures(taskResults)

		const metadata: AnalysisMetadata = {
			generated_at: new Date().toISOString(),
			analysis_version: "1.0.0", // TODO: Get from package.json
			job_id: path.basename(jobDir),
			model: config.model,
			agent: config.agent || "cline-cli",
			environment: config.environment || "docker",
		}

		return {
			schema_version: "1.0",
			metadata,
			summary,
			tasks: taskResults,
			failures,
		}
	}

	/**
	 * Find all trial directories in a job
	 */
	private findTrialDirectories(jobDir: string): string[] {
		const entries = fs.readdirSync(jobDir, { withFileTypes: true })

		return entries
			.filter((entry) => entry.isDirectory())
			.filter((entry) => {
				// Trial dirs have format: 01k7a12s...disco__fhSEuhr
				const configExists = fs.existsSync(path.join(jobDir, entry.name, "config.json"))
				return configExists
			})
			.map((entry) => path.join(jobDir, entry.name))
	}

	/**
	 * Parse a single trial directory
	 */
	private parseTrialDirectory(trialDir: string): ParsedTrial {
		const configPath = path.join(trialDir, "config.json")
		const resultPath = path.join(trialDir, "result.json")
		const rewardPath = path.join(trialDir, "verifier", "reward.txt")
		const logsPath = path.join(trialDir, "agent", "cline.txt")
		const testOutputPath = path.join(trialDir, "verifier", "test-stdout.txt")

		const config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
		const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"))
		const reward = fs.readFileSync(rewardPath, "utf-8").trim()
		const logs = fs.existsSync(logsPath) ? fs.readFileSync(logsPath, "utf-8") : ""
		const testOutput = fs.existsSync(testOutputPath) ? fs.readFileSync(testOutputPath, "utf-8") : ""

		const passed = reward === "1"
		const failures = passed ? [] : this.classifier.classify(logs)

		return {
			taskId: config.task_id,
			trialHash: path.basename(trialDir).split("__")[1] || "",
			passed,
			duration: result.duration_sec || 0,
			cost: result.cost_usd || 0,
			tokensIn: result.tokens_in,
			tokensOut: result.tokens_out,
			logs,
			testOutput,
			failures,
		}
	}

	/**
	 * Group trials by task ID and calculate metrics
	 */
	private groupTrialsByTask(trials: ParsedTrial[]): TaskResultV1[] {
		const taskMap = new Map<string, ParsedTrial[]>()

		// Group trials by task ID
		for (const trial of trials) {
			const existing = taskMap.get(trial.taskId) || []
			existing.push(trial)
			taskMap.set(trial.taskId, existing)
		}

		// Convert to TaskResultV1 format
		const taskResults: TaskResultV1[] = []

		for (const [taskId, taskTrials] of taskMap.entries()) {
			const trialResults: TrialResultV1[] = taskTrials.map((trial, index) => ({
				trial_index: index,
				trial_hash: trial.trialHash,
				passed: trial.passed,
				duration_sec: trial.duration,
				cost_usd: trial.cost,
				tokens_in: trial.tokensIn,
				tokens_out: trial.tokensOut,
				failures: trial.failures,
			}))

			const passResults = taskTrials.map((t) => t.passed)
			const metrics = this.metrics.calculateTaskMetrics(passResults)
			const status = this.metrics.getTaskStatus(passResults)

			const totalCost = taskTrials.reduce((sum, t) => sum + t.cost, 0)
			const avgDuration = taskTrials.reduce((sum, t) => sum + t.duration, 0) / taskTrials.length

			// Extract readable task name from ID
			const taskName = this.extractTaskName(taskId)

			taskResults.push({
				task_id: taskId,
				task_name: taskName,
				trials: trialResults,
				metrics,
				status,
				total_cost_usd: totalCost,
				avg_duration_sec: avgDuration,
			})
		}

		return taskResults.sort((a, b) => a.task_name.localeCompare(b.task_name))
	}

	/**
	 * Extract human-readable task name from task ID
	 * Example: 01k7a12sd1nk15j08e6x0x7v9e-discord-trivia-approval-keyerror → discord-trivia
	 */
	private extractTaskName(taskId: string): string {
		const parts = taskId.split("-")
		if (parts.length > 1) {
			// Remove the ID prefix and get first 2-3 meaningful words
			const words = parts.slice(1, 4)
			return words.join("-")
		}
		return taskId
	}

	/**
	 * Calculate aggregate summary metrics
	 */
	private calculateSummary(taskResults: TaskResultV1[]): AnalysisSummary {
		const totalTasks = taskResults.length
		const totalTrials = taskResults.reduce((sum, task) => sum + task.trials.length, 0)

		// Calculate overall pass@k metrics
		const allTrials = taskResults.flatMap((task) => task.trials.map((t) => t.passed))
		let passAt1 = 0
		let passAt3 = 0
		let passCaret3 = 0

		if (allTrials.length >= 1) {
			passAt1 = this.metrics.passAtK(allTrials, 1)
		}
		if (allTrials.length >= 3) {
			passAt3 = this.metrics.passAtK(allTrials, 3)
			passCaret3 = this.metrics.passCaretK(allTrials, 3)
		}

		const totalCost = taskResults.reduce((sum, task) => sum + task.total_cost_usd, 0)
		const totalDuration = taskResults.reduce((sum, task) => sum + task.avg_duration_sec * task.trials.length, 0)

		const flakyTaskCount = taskResults.filter((task) => task.status === "flaky").length

		return {
			total_tasks: totalTasks,
			total_trials: totalTrials,
			pass_at_1: passAt1,
			pass_at_3: passAt3,
			pass_caret_3: passCaret3,
			total_cost_usd: totalCost,
			total_duration_sec: totalDuration,
			flaky_task_count: flakyTaskCount,
		}
	}

	/**
	 * Analyze failure patterns across all tasks
	 */
	private analyzeFailures(taskResults: TaskResultV1[]): FailureAnalysis {
		const categoryCount = new Map<string, number>()
		const patternCount = new Map<string, { count: number; issue_url?: string; examples: any[] }>()

		for (const task of taskResults) {
			for (const trial of task.trials) {
				if (!trial.passed) {
					for (const failure of trial.failures) {
						// Count by category
						categoryCount.set(failure.category, (categoryCount.get(failure.category) || 0) + 1)

						// Count by pattern
						const existing = patternCount.get(failure.name) || {
							count: 0,
							issue_url: failure.issue_url,
							examples: [],
						}
						existing.count++

						// Add example if not too many
						if (existing.examples.length < 3) {
							existing.examples.push({
								task_id: task.task_id,
								trial_index: trial.trial_index,
								excerpt: failure.excerpt,
							})
						}

						patternCount.set(failure.name, existing)
					}
				}
			}
		}

		const byCategory: Record<string, number> = {}
		for (const [category, count] of categoryCount.entries()) {
			byCategory[category] = count
		}

		const byPattern = Array.from(patternCount.entries()).map(([name, data]) => ({
			name,
			count: data.count,
			issue_url: data.issue_url,
			examples: data.examples,
		}))

		return { by_category: byCategory as any, by_pattern: byPattern }
	}
}

interface ParsedTrial {
	taskId: string
	trialHash: string
	passed: boolean
	duration: number
	cost: number
	tokensIn?: number
	tokensOut?: number
	logs: string
	testOutput: string
	failures: any[]
}
