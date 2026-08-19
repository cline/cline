#!/usr/bin/env npx tsx
/**
 * cline-bench Runner
 *
 * Runs real-world tasks from cline-bench using Harbor framework.
 * Designed for nightly CI execution.
 *
 * Prerequisites:
 *   - Python 3.13 with uv
 *   - Harbor installed (`uv tool install harbor`)
 *   - Docker (for local) or DAYTONA_API_KEY (for cloud)
 *
 * Usage:
 *   npx tsx evals/e2e/run-cline-bench.ts [options]
 *
 * Options:
 *   --env <docker|daytona>  Execution environment (default: docker)
 *   --provider <name>       Provider to use (default: anthropic)
 *   --model <id>            Model ID (default: claude-sonnet-4-20250514)
 *   --tasks <pattern>       Task filter pattern (default: all)
 *   --trials <n>            Number of trials per task (default: 1)
 *   --output <file>         Write results to JSON file
 */

import { execSync, spawnSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

interface RunOptions {
	env: "docker" | "daytona"
	provider: string
	model: string
	tasks: string
	trials: number
	outputFile?: string
}

// Provider configurations for Harbor model format
const PROVIDER_MODEL_PREFIX: Record<string, string> = {
	anthropic: "anthropic",
	openrouter: "openrouter",
	openai: "openai-native",
	gemini: "gemini", // Needs different handling
}

const PROVIDER_API_KEY_ENV: Record<string, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	openai: "OPENAI_API_KEY",
	gemini: "GEMINI_API_KEY",
}

function checkPrerequisites(): { ok: boolean; error?: string } {
	// Check Python
	try {
		const pythonVersion = execSync("python3 --version", { encoding: "utf-8" })
		if (!pythonVersion.includes("3.13")) {
			console.warn(`Warning: Python 3.13 recommended, found: ${pythonVersion.trim()}`)
		}
	} catch {
		return { ok: false, error: "Python 3 not found" }
	}

	// Check Harbor
	try {
		execSync("which harbor", { encoding: "utf-8" })
	} catch {
		return { ok: false, error: "Harbor not found. Install with: uv tool install harbor" }
	}

	// Check Docker (for local env)
	try {
		execSync("docker info > /dev/null 2>&1")
	} catch {
		console.warn("Warning: Docker not available. Use --env daytona for cloud execution.")
	}

	return { ok: true }
}

function getTaskList(clineBenchDir: string, filter?: string): string[] {
	const tasksDir = path.join(clineBenchDir, "tasks")
	if (!fs.existsSync(tasksDir)) {
		throw new Error(`Tasks directory not found: ${tasksDir}`)
	}

	let tasks = fs
		.readdirSync(tasksDir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)

	if (filter && filter !== "all") {
		tasks = tasks.filter((t) => t.includes(filter))
	}

	return tasks
}

interface TaskResult {
	taskId: string
	passed: boolean
	duration_sec: number
	error?: string
}

function runHarborTask(clineBenchDir: string, taskId: string, options: RunOptions): TaskResult {
	const startTime = Date.now()

	// Build Harbor model string
	const modelPrefix = PROVIDER_MODEL_PREFIX[options.provider] || options.provider
	const harborModel = `${modelPrefix}:${options.model}`

	// Set up environment
	const apiKeyEnv = PROVIDER_API_KEY_ENV[options.provider]
	const apiKey = process.env[apiKeyEnv] || process.env.API_KEY

	if (!apiKey) {
		return {
			taskId,
			passed: false,
			duration_sec: 0,
			error: `Missing API key: ${apiKeyEnv} or API_KEY`,
		}
	}

	const harborEnv = {
		...process.env,
		API_KEY: apiKey,
	}

	// Build Harbor command
	const harborArgs = ["run", "-p", `tasks/${taskId}`, "-a", "cline-cli", "-m", harborModel, "--env", options.env]

	console.log(`  Running: harbor ${harborArgs.join(" ")}`)

	try {
		const result = spawnSync("harbor", harborArgs, {
			cwd: clineBenchDir,
			env: harborEnv,
			stdio: ["inherit", "pipe", "pipe"],
			timeout: 30 * 60 * 1000, // 30 minutes
		})

		const duration_sec = (Date.now() - startTime) / 1000

		if (result.status !== 0) {
			return {
				taskId,
				passed: false,
				duration_sec,
				error: result.stderr?.toString() || `Exit code: ${result.status}`,
			}
		}

		// Check if task passed by looking at the latest job results
		// Harbor writes results to jobs/ directory
		const jobsDir = path.join(clineBenchDir, "jobs")
		if (fs.existsSync(jobsDir)) {
			const latestJob = fs
				.readdirSync(jobsDir)
				.filter((d) => d.startsWith("2"))
				.sort()
				.pop()

			if (latestJob) {
				const jobDir = path.join(jobsDir, latestJob)
				const trialDirs = fs.readdirSync(jobDir).filter((d) => d.includes(taskId.substring(0, 10)))

				for (const trialDir of trialDirs) {
					const rewardFile = path.join(jobDir, trialDir, "verifier", "reward.txt")
					if (fs.existsSync(rewardFile)) {
						const reward = fs.readFileSync(rewardFile, "utf-8").trim()
						return {
							taskId,
							passed: reward === "1",
							duration_sec,
						}
					}
				}
			}
		}

		// Couldn't determine result from files
		return {
			taskId,
			passed: false,
			duration_sec,
			error: "Could not determine task result",
		}
	} catch (error: any) {
		return {
			taskId,
			passed: false,
			duration_sec: (Date.now() - startTime) / 1000,
			error: error.message || String(error),
		}
	}
}

interface BenchmarkReport {
	timestamp: string
	provider: string
	model: string
	environment: string
	trialsPerTask: number
	results: TaskResult[]
	summary: {
		total: number
		passed: number
		failed: number
		passRate: number
	}
}

async function main() {
	const args = process.argv.slice(2)

	// Parse arguments
	const options: RunOptions = {
		env: "docker",
		provider: "anthropic",
		model: "claude-sonnet-4-20250514",
		tasks: "all",
		trials: 1,
	}

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--env" && args[i + 1]) {
			options.env = args[++i] as "docker" | "daytona"
		} else if (args[i] === "--provider" && args[i + 1]) {
			options.provider = args[++i]
		} else if (args[i] === "--model" && args[i + 1]) {
			options.model = args[++i]
		} else if (args[i] === "--tasks" && args[i + 1]) {
			options.tasks = args[++i]
		} else if (args[i] === "--trials" && args[i + 1]) {
			options.trials = parseInt(args[++i], 10)
		} else if (args[i] === "--output" && args[i + 1]) {
			options.outputFile = args[++i]
		}
	}

	// Check prerequisites
	const prereq = checkPrerequisites()
	if (!prereq.ok) {
		console.error(`Prerequisite check failed: ${prereq.error}`)
		process.exit(1)
	}

	// Find cline-bench directory
	const clineBenchDir = path.join(__dirname, "..", "cline-bench")
	if (!fs.existsSync(clineBenchDir)) {
		console.error(`cline-bench not found at: ${clineBenchDir}`)
		console.error("Ensure the submodule is initialized: git submodule update --init")
		process.exit(1)
	}

	// Get task list
	const tasks = getTaskList(clineBenchDir, options.tasks)
	if (tasks.length === 0) {
		console.error("No tasks found matching filter:", options.tasks)
		process.exit(1)
	}

	console.log(`cline-bench E2E Runner`)
	console.log(`======================`)
	console.log(`Provider: ${options.provider}`)
	console.log(`Model: ${options.model}`)
	console.log(`Environment: ${options.env}`)
	console.log(`Tasks: ${tasks.length}`)
	console.log(`Trials per task: ${options.trials}`)
	console.log("")

	const results: TaskResult[] = []

	// Run tasks
	for (const taskId of tasks) {
		console.log(`\n[${taskId}]`)

		for (let trial = 0; trial < options.trials; trial++) {
			if (options.trials > 1) {
				console.log(`  Trial ${trial + 1}/${options.trials}`)
			}

			const result = runHarborTask(clineBenchDir, taskId, options)
			results.push(result)

			console.log(`  Result: ${result.passed ? "✓ PASS" : `✗ FAIL: ${result.error || "unknown"}`}`)
			console.log(`  Duration: ${result.duration_sec.toFixed(1)}s`)
		}
	}

	// Generate report
	const passed = results.filter((r) => r.passed).length
	const report: BenchmarkReport = {
		timestamp: new Date().toISOString(),
		provider: options.provider,
		model: options.model,
		environment: options.env,
		trialsPerTask: options.trials,
		results,
		summary: {
			total: results.length,
			passed,
			failed: results.length - passed,
			passRate: results.length > 0 ? passed / results.length : 0,
		},
	}

	// Output
	if (options.outputFile) {
		fs.writeFileSync(options.outputFile, JSON.stringify(report, null, 2))
		console.log(`\nResults written to: ${options.outputFile}`)
	}

	// Summary
	console.log("\n" + "=".repeat(60))
	console.log("SUMMARY")
	console.log("=".repeat(60))
	console.log(`Total: ${report.summary.total}`)
	console.log(`Passed: ${report.summary.passed}`)
	console.log(`Failed: ${report.summary.failed}`)
	console.log(`Pass Rate: ${(report.summary.passRate * 100).toFixed(1)}%`)

	// Exit with error if any failures
	if (report.summary.failed > 0) {
		process.exit(1)
	}
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
