#!/usr/bin/env npx tsx
/**
 * Smoke Test Runner for Cline
 *
 * Runs curated smoke tests against configured providers to verify:
 * - Basic tool execution works
 * - Provider responses are correctly parsed
 * - Thinking traces are preserved
 *
 * Usage:
 *   npx tsx evals/smoke-tests/run-smoke-tests.ts [options]
 *
 * Options:
 *   --provider <name>  Run tests for a specific provider (default: all configured)
 *   --trials <n>       Number of trials per test (default: 3)
 *   --scenario <name>  Run a specific scenario (default: all)
 *   --output <file>    Write JSON results to file
 */

import { execSync, spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { MetricsCalculator } from "../analysis/src/metrics"

// Default provider and model for smoke tests
// These ensure deterministic behavior regardless of local config
const DEFAULT_PROVIDER = "cline"
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5"

// Models to test - can be overridden with --model flag
const MODELS: string[] = [DEFAULT_MODEL]

// Check if cline CLI is available
function checkClineCli(): boolean {
	try {
		execSync("which cline", { encoding: "utf-8", timeout: 5000 })
		return true
	} catch {
		return false
	}
}

// Use user's existing Cline config (already has auth configured)
// For CI, this would be set up by the auth step before tests run
const CLINE_CONFIG_DIR = path.join(process.env.HOME || "", ".cline")

// Configure authentication using CLINE_API_KEY environment variable
// Returns success if auth is configured, error message otherwise
function configureAuth(): { ok: boolean; error?: string } {
	const apiKey = process.env.CLINE_API_KEY
	if (!apiKey) {
		return {
			ok: false,
			error: "CLINE_API_KEY environment variable not set",
		}
	}

	// Ensure config directory exists
	fs.mkdirSync(CLINE_CONFIG_DIR, { recursive: true })

	try {
		// Run quick auth setup (non-interactive when all flags provided)
		execSync(`cline auth --config "${CLINE_CONFIG_DIR}" -p ${DEFAULT_PROVIDER} -k "${apiKey}" -m "${DEFAULT_MODEL}"`, {
			encoding: "utf-8",
			timeout: 10000,
			stdio: "pipe",
		})
		return { ok: true }
	} catch (err: any) {
		return {
			ok: false,
			error: err.message || "Auth command failed",
		}
	}
}

// Smoke test scenario definition
interface SmokeScenario {
	id: string
	name: string
	description: string
	prompt: string
	workdir: string // Relative to scenario directory
	expectedFiles?: string[] // Files that should exist after
	expectedContent?: { file: string; contains: string }[] // Content checks
	timeout: number // Seconds
	models?: string[] // Optional: override default models for this scenario
}

// Load scenarios from disk
function loadScenarios(scenariosDir: string): SmokeScenario[] {
	const scenarios: SmokeScenario[] = []

	for (const entry of fs.readdirSync(scenariosDir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			const configPath = path.join(scenariosDir, entry.name, "config.json")
			if (fs.existsSync(configPath)) {
				const config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
				scenarios.push({
					...config,
					id: entry.name,
					workdir: path.join(scenariosDir, entry.name, "workspace"),
				})
			}
		}
	}

	return scenarios
}

// Run a single trial
interface TrialResult {
	passed: boolean
	error?: string
	durationMs: number
	stdout: string
	stderr: string
}

async function runTrial(scenario: SmokeScenario, modelId: string, trialWorkdir: string): Promise<TrialResult> {
	const startTime = Date.now()

	// Ensure workspace exists and is clean
	if (fs.existsSync(trialWorkdir)) {
		fs.rmSync(trialWorkdir, { recursive: true })
	}
	fs.mkdirSync(trialWorkdir, { recursive: true })

	// Copy any template files from scenario
	const templateDir = path.join(path.dirname(scenario.workdir), "template")
	if (fs.existsSync(templateDir)) {
		fs.cpSync(templateDir, trialWorkdir, { recursive: true })
	}

	// Build CLI command with explicit model setting for determinism
	// Provider is configured via `cline auth` before running tests
	const args = [
		"--config",
		CLINE_CONFIG_DIR, // Use shared config directory for auth
		"-y", // YOLO mode - auto-approve all actions, exits after completion
		"-t",
		String(scenario.timeout), // CLI timeout (matches our timeout)
		"-m",
		modelId, // Model to use (overrides configured default)
		scenario.prompt,
	]

	try {
		// Run cline CLI
		const result = await runClineWithTimeout(args, trialWorkdir, scenario.timeout * 1000)

		if (!result.success) {
			return {
				passed: false,
				error: result.error || "CLI execution failed",
				durationMs: Date.now() - startTime,
				stdout: result.stdout,
				stderr: result.stderr,
			}
		}

		// Verify expected files
		if (scenario.expectedFiles) {
			for (const file of scenario.expectedFiles) {
				const filePath = path.join(trialWorkdir, file)
				if (!fs.existsSync(filePath)) {
					return {
						passed: false,
						error: `Expected file not found: ${file}`,
						durationMs: Date.now() - startTime,
						stdout: result.stdout,
						stderr: result.stderr,
					}
				}
			}
		}

		// Verify expected content
		if (scenario.expectedContent) {
			for (const check of scenario.expectedContent) {
				const filePath = path.join(trialWorkdir, check.file)
				if (!fs.existsSync(filePath)) {
					return {
						passed: false,
						error: `File not found for content check: ${check.file}`,
						durationMs: Date.now() - startTime,
						stdout: result.stdout,
						stderr: result.stderr,
					}
				}
				const content = fs.readFileSync(filePath, "utf-8")
				if (!content.includes(check.contains)) {
					return {
						passed: false,
						error: `Expected content not found in ${check.file}: "${check.contains}"`,
						durationMs: Date.now() - startTime,
						stdout: result.stdout,
						stderr: result.stderr,
					}
				}
			}
		}

		return {
			passed: true,
			durationMs: Date.now() - startTime,
			stdout: result.stdout,
			stderr: result.stderr,
		}
	} catch (error: any) {
		return {
			passed: false,
			error: error.message || String(error),
			durationMs: Date.now() - startTime,
			stdout: "",
			stderr: "",
		}
	}
}

// Run cline CLI with timeout
interface ClineResult {
	success: boolean
	error?: string
	stdout: string
	stderr: string
}

function runClineWithTimeout(args: string[], cwd: string, timeoutMs: number): Promise<ClineResult> {
	return new Promise((resolve) => {
		let stdout = ""
		let stderr = ""

		const proc = spawn("cline", args, {
			cwd,
			env: { ...process.env },
			stdio: ["ignore", "pipe", "pipe"], // stdin: ignore, stdout/stderr: pipe
		})

		const timeout = setTimeout(() => {
			proc.kill("SIGKILL")
			resolve({
				success: false,
				error: "Timeout exceeded",
				stdout,
				stderr,
			})
		}, timeoutMs)

		proc.stdout?.on("data", (data) => {
			stdout += data.toString()
		})

		proc.stderr?.on("data", (data) => {
			stderr += data.toString()
		})

		proc.on("error", (err) => {
			clearTimeout(timeout)
			resolve({
				success: false,
				error: err.message,
				stdout,
				stderr,
			})
		})

		proc.on("close", (code) => {
			clearTimeout(timeout)
			let error: string | undefined
			if (code !== 0) {
				// Include last line of stderr for context
				const lastStderr = stderr.trim().split("\n").slice(-3).join(" | ")
				error = `Exit code: ${code}${lastStderr ? ` - ${lastStderr}` : ""}`
			}
			resolve({
				success: code === 0,
				error,
				stdout,
				stderr,
			})
		})
	})
}

// Result types
interface ScenarioResult {
	scenarioId: string
	scenarioName: string
	model: string
	modelId: string
	trials: TrialResult[]
	metrics: {
		passAt1: number
		passAt3: number
		passCaret3: number
		flakinessScore: number
	}
	status: "pass" | "fail" | "flaky"
}

interface SmokeTestReport {
	timestamp: string
	provider: string
	models: string[]
	scenarios: string[]
	trialsPerTest: number
	results: ScenarioResult[]
	summary: {
		total: number
		passed: number
		failed: number
		flaky: number
		passAt1Overall: number
		passAt3Overall: number
	}
}

// Main execution
async function main() {
	const args = process.argv.slice(2)

	// Parse arguments
	let selectedModel: string | undefined
	let trials = 3
	let selectedScenario: string | undefined
	let outputFile: string | undefined
	let parallel = false
	let parallelLimit = 4

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--model" && args[i + 1]) {
			selectedModel = args[++i]
		} else if (args[i] === "--trials" && args[i + 1]) {
			trials = parseInt(args[++i], 10)
		} else if (args[i] === "--scenario" && args[i + 1]) {
			selectedScenario = args[++i]
		} else if (args[i] === "--output" && args[i + 1]) {
			outputFile = args[++i]
		} else if (args[i] === "--parallel") {
			parallel = true
			if (args[i + 1] && !args[i + 1].startsWith("--")) {
				parallelLimit = parseInt(args[++i], 10)
			}
		}
	}

	// Check cline CLI is available
	if (!checkClineCli()) {
		console.error("ERROR: cline CLI not found in PATH")
		console.error("")
		console.error("For local development:")
		console.error("  cd cli && npm install && npm run build && npm link")
		console.error("")
		console.error("For CI:")
		console.error("  Ensure CLI build and 'npm link' steps completed")
		process.exit(1)
	}

	// Configure authentication if CLINE_API_KEY is set
	// Otherwise use existing auth from ~/.cline
	if (process.env.CLINE_API_KEY) {
		console.log("Configuring authentication from CLINE_API_KEY...")
		const authResult = configureAuth()
		if (!authResult.ok) {
			console.error("")
			console.error("ERROR: Authentication failed")
			console.error(`  ${authResult.error}`)
			console.error("")
			process.exit(1)
		}
		console.log("Authentication configured")
	} else {
		console.log("Using existing authentication from ~/.cline")
	}
	console.log("")

	// Load scenarios
	const scenariosDir = path.join(__dirname, "scenarios")
	let scenarios = loadScenarios(scenariosDir)

	if (scenarios.length === 0) {
		console.error("No scenarios found in", scenariosDir)
		process.exit(1)
	}

	if (selectedScenario) {
		scenarios = scenarios.filter((s) => s.id === selectedScenario)
		if (scenarios.length === 0) {
			console.error(`Scenario not found: ${selectedScenario}`)
			process.exit(1)
		}
	}

	// Filter models
	let models = MODELS
	if (selectedModel) {
		models = [selectedModel]
	}

	// Create results directory with timestamp
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
	const resultsBaseDir = path.join(__dirname, "results")
	const resultsDir = path.join(resultsBaseDir, timestamp)
	fs.mkdirSync(resultsDir, { recursive: true })

	// Models are now always explicit
	const resolvedModels = models

	console.log(`Running ${scenarios.length} scenarios × ${models.length} models × ${trials} trials`)
	console.log(`Provider: ${DEFAULT_PROVIDER}`)
	console.log(`Models: ${resolvedModels.join(", ")}`)
	console.log(`Scenarios: ${scenarios.map((s) => s.id).join(", ")}`)
	console.log(`Results: ${resultsDir}`)
	console.log(`Parallel: ${parallel ? `yes (limit: ${parallelLimit})` : "no"}`)
	console.log("")

	const metricsCalc = new MetricsCalculator()
	const results: ScenarioResult[] = []

	// Build list of all scenario+model combinations
	interface TestJob {
		scenario: Scenario
		modelId: string
	}
	const jobs: TestJob[] = []
	for (const scenario of scenarios) {
		const scenarioModels = selectedModel ? [selectedModel] : scenario.models || models
		for (const modelId of scenarioModels) {
			jobs.push({ scenario, modelId })
		}
	}

	// Run a single job
	async function runJob(job: TestJob): Promise<ScenarioResult> {
		const { scenario, modelId } = job
		const logDir = path.join(resultsDir, scenario.id, modelId)
		fs.mkdirSync(logDir, { recursive: true })

		const trialResults: TrialResult[] = []
		const trialWorkdirs: string[] = []

		for (let t = 0; t < trials; t++) {
			const trialWorkdir = path.join(logDir, `workspace-trial-${t + 1}`)
			trialWorkdirs.push(trialWorkdir)
			const result = await runTrial(scenario, modelId, trialWorkdir)
			trialResults.push(result)
		}

		trialResults.forEach((result, t) => {
			const trialNum = t + 1
			const logContent =
				`# Trial ${trialNum}\n` +
				`Status: ${result.passed ? "PASS" : "FAIL"}\n` +
				`Duration: ${result.durationMs}ms\n` +
				(result.error ? `Error: ${result.error}\n` : "") +
				`\n## STDOUT\n${result.stdout || "(empty)"}\n` +
				`\n## STDERR\n${result.stderr || "(empty)"}\n`
			fs.writeFileSync(path.join(logDir, `trial-${trialNum}.log`), logContent)
		})

		const trialBools = trialResults.map((t) => t.passed)
		const metrics = metricsCalc.calculateTaskMetrics(trialBools)
		const status = metricsCalc.getTaskStatus(trialBools)

		return {
			scenarioId: scenario.id,
			scenarioName: scenario.name,
			model: modelId,
			modelId: modelId,
			trials: trialResults,
			metrics,
			status,
		}
	}

	if (parallel) {
		// Run jobs in parallel with concurrency limit
		console.log(`Running ${jobs.length} jobs in parallel...`)
		const executing: Promise<void>[] = []

		for (const job of jobs) {
			const p = runJob(job).then((result) => {
				results.push(result)
				const passMetric = trials >= 3 ? result.metrics.passAt3 : result.metrics.passAt1
				const icon = result.status === "pass" ? "✓" : result.status === "flaky" ? "~" : "✗"
				console.log(
					`  ${icon} [${result.scenarioId}] ${result.model}: ${result.status.toUpperCase()} (${(passMetric * 100).toFixed(0)}%)`,
				)
			})
			executing.push(p as unknown as Promise<void>)

			if (executing.length >= parallelLimit) {
				await Promise.race(executing)
				// Remove settled promises
				for (let i = executing.length - 1; i >= 0; i--) {
					const settled = await Promise.race([executing[i].then(() => true).catch(() => true), Promise.resolve(false)])
					if (settled) executing.splice(i, 1)
				}
			}
		}
		await Promise.all(executing)
	} else {
		// Sequential execution
		for (const job of jobs) {
			console.log(`\n[${job.scenario.id}] ${job.scenario.name} (${job.modelId})`)
			const logDir = path.join(resultsDir, job.scenario.id, job.modelId)
			fs.mkdirSync(logDir, { recursive: true })

			const trialResults: TrialResult[] = []
			const trialWorkdirs: string[] = []

			for (let t = 0; t < trials; t++) {
				const trialWorkdir = path.join(logDir, `workspace-trial-${t + 1}`)
				trialWorkdirs.push(trialWorkdir)
				process.stdout.write(`  Trial ${t + 1}/${trials}... `)
				const result = await runTrial(job.scenario, job.modelId, trialWorkdir)
				trialResults.push(result)
				console.log(result.passed ? "✓ PASS" : `✗ FAIL: ${result.error}`)
			}

			trialResults.forEach((result, t) => {
				const trialNum = t + 1
				const logContent =
					`# Trial ${trialNum}\n` +
					`Status: ${result.passed ? "PASS" : "FAIL"}\n` +
					`Duration: ${result.durationMs}ms\n` +
					(result.error ? `Error: ${result.error}\n` : "") +
					`\n## STDOUT\n${result.stdout || "(empty)"}\n` +
					`\n## STDERR\n${result.stderr || "(empty)"}\n`
				fs.writeFileSync(path.join(logDir, `trial-${trialNum}.log`), logContent)
			})

			const trialBools = trialResults.map((t) => t.passed)
			const metrics = metricsCalc.calculateTaskMetrics(trialBools)
			const status = metricsCalc.getTaskStatus(trialBools)

			results.push({
				scenarioId: job.scenario.id,
				scenarioName: job.scenario.name,
				model: job.modelId,
				modelId: job.modelId,
				trials: trialResults,
				metrics,
				status,
			})

			// Display pass@k where k = actual trials (pass@3 is meaningless with fewer trials)
			const passMetric = trials >= 3 ? metrics.passAt3 : metrics.passAt1
			const passLabel = trials >= 3 ? "pass@3" : "pass@1"
			console.log(`  Result: ${status.toUpperCase()} | ${passLabel}: ${(passMetric * 100).toFixed(0)}%`)
		}
	}

	// Generate report
	const report: SmokeTestReport = {
		timestamp: new Date().toISOString(),
		provider: DEFAULT_PROVIDER,
		models: resolvedModels,
		scenarios: scenarios.map((s) => s.id),
		trialsPerTest: trials,
		results,
		summary: {
			total: results.length,
			passed: results.filter((r) => r.status === "pass").length,
			failed: results.filter((r) => r.status === "fail").length,
			flaky: results.filter((r) => r.status === "flaky").length,
			passAt1Overall: results.length > 0 ? results.reduce((sum, r) => sum + r.metrics.passAt1, 0) / results.length : 0,
			passAt3Overall: results.length > 0 ? results.reduce((sum, r) => sum + r.metrics.passAt3, 0) / results.length : 0,
		},
	}

	// Save report.json
	fs.writeFileSync(path.join(resultsDir, "report.json"), JSON.stringify(report, null, 2))

	// Generate summary.md for CI job summary
	const summaryMd = generateSummaryMarkdown(report)
	fs.writeFileSync(path.join(resultsDir, "summary.md"), summaryMd)

	// Create/update 'latest' symlink
	const latestLink = path.join(resultsBaseDir, "latest")
	try {
		if (fs.existsSync(latestLink)) {
			fs.unlinkSync(latestLink)
		}
		fs.symlinkSync(timestamp, latestLink)
	} catch {
		// Symlinks may fail on some systems, ignore
	}

	// Also write to custom output file if specified
	if (outputFile) {
		fs.writeFileSync(outputFile, JSON.stringify(report, null, 2))
		console.log(`\nResults also written to: ${outputFile}`)
	}

	// Summary
	console.log("\n" + "=".repeat(60))
	console.log("SUMMARY")
	console.log("=".repeat(60))
	console.log(`Total: ${report.summary.total}`)
	console.log(`Passed: ${report.summary.passed}`)
	console.log(`Failed: ${report.summary.failed}`)
	console.log(`Flaky: ${report.summary.flaky}`)
	const passLabel = report.trialsPerTest >= 3 ? "pass@3" : "pass@1"
	const passOverall = report.trialsPerTest >= 3 ? report.summary.passAt3Overall : report.summary.passAt1Overall
	console.log(`Overall ${passLabel}: ${(passOverall * 100).toFixed(1)}%`)
	console.log(`\nFull results: ${resultsDir}`)
	console.log(`Latest link: ${latestLink}`)

	// Exit with error if any failures
	if (report.summary.failed > 0) {
		process.exit(1)
	}
}

// Generate markdown summary for CI
function generateSummaryMarkdown(report: SmokeTestReport): string {
	const lines: string[] = []
	lines.push("## Smoke Test Results")
	lines.push("")
	lines.push(`**Date:** ${report.timestamp}`)

	// Show unique model IDs from results
	const modelIds = [...new Set(report.results.map((r) => r.modelId))]
	lines.push(`**Models:** ${modelIds.join(", ")}`)
	lines.push(`**Trials per test:** ${report.trialsPerTest}`)
	lines.push("")
	lines.push("### Summary")
	lines.push("")
	lines.push(`| Metric | Value |`)
	lines.push(`|--------|-------|`)
	lines.push(`| Total | ${report.summary.total} |`)
	lines.push(`| Passed | ${report.summary.passed} |`)
	lines.push(`| Failed | ${report.summary.failed} |`)
	lines.push(`| Flaky | ${report.summary.flaky} |`)
	const mdPassLabel = report.trialsPerTest >= 3 ? "pass@3" : "pass@1"
	const mdPassOverall = report.trialsPerTest >= 3 ? report.summary.passAt3Overall : report.summary.passAt1Overall
	lines.push(`| Overall ${mdPassLabel} | ${(mdPassOverall * 100).toFixed(1)}% |`)
	lines.push("")

	// Results table
	lines.push("### Results by Scenario")
	lines.push("")
	lines.push(`| Scenario | Model | Status | ${mdPassLabel} |`)
	lines.push("|----------|-------|--------|--------|")
	for (const r of report.results) {
		const statusEmoji = r.status === "pass" ? "✅" : r.status === "flaky" ? "⚠️" : "❌"
		const rPassMetric = report.trialsPerTest >= 3 ? r.metrics.passAt3 : r.metrics.passAt1
		lines.push(
			`| ${r.scenarioId} | ${r.modelId} | ${statusEmoji} ${r.status.toUpperCase()} | ${(rPassMetric * 100).toFixed(0)}% |`,
		)
	}
	lines.push("")

	// Failed/flaky details
	const problemResults = report.results.filter((r) => r.status !== "pass")
	if (problemResults.length > 0) {
		lines.push("### Failed/Flaky Details")
		lines.push("")
		for (const r of problemResults) {
			lines.push(`#### ${r.scenarioId} (${r.modelId})`)
			lines.push("")
			r.trials.forEach((t, i) => {
				if (!t.passed) {
					lines.push(`- Trial ${i + 1}: ${t.error}`)
				}
			})
			lines.push("")
		}
	}

	return lines.join("\n")
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
