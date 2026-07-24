#!/usr/bin/env bun

/**
 * Cost-guarded Cline benchmark pilot.
 *
 * This runner intentionally differs from run-cline-bench.ts:
 * - dry-run is the default; paid execution requires --execute
 * - exactly one task runs at a time, once
 * - only an allowlist of host environment variables reaches Harbor
 * - task/model/global budget checks stop subsequent work
 * - jobs and reports live outside the repository with private permissions
 *
 * Harbor/Cline currently reports cost only after an agent run finishes. The
 * per-task budget is therefore a stop-after-run guard, while the wall timeout
 * is the proactive bound during a run.
 */

import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

type ModelConfig = {
	id: string
	perTaskBudgetUsd: number
	perModelBudgetUsd: number
	pricing?: {
		inputPerMTok: number
		cachedInputPerMTok: number
		outputPerMTok: number
	}
}

type PilotConfig = {
	routerProfile: "cline-router" | "cline-pass-router"
	provider: string
	globalBudgetUsd: number
	maxRunsPerModel: number
	timeoutSeconds: number
	clineVersion: string
	models: ModelConfig[]
	tasks: string[]
}

type RunResult = {
	model: string
	task: string
	outcome: "passed" | "failed" | "timed_out"
	passed: boolean
	reward: number | null
	costUsd: number
	costBasis: "reported-inference" | "cline-pass-reference-quota"
	durationSeconds: number
	inputTokens: number | null
	cacheTokens: number | null
	outputTokens: number | null
	cacheReadRatio: number | null
	estimatedTokenCostUsd: number | null
	coldEquivalentCostUsd: number | null
	estimatedCacheSavingsUsd: number | null
	jobDir: string
}

type PilotReport = {
	startedAt: string
	finishedAt?: string
	mode: "dry-run" | "execute"
	config: PilotConfig
	jobsRoot: string
	results: RunResult[]
	stoppedReason?: string
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "../..")
const clineBenchDir = join(repoRoot, "evals/cline-bench")
const defaultConfigPath = join(scriptDir, "cline-bench-pilot.config.json")

function fail(message: string): never {
	throw new Error(message)
}

function parseArgs(argv: string[]) {
	let execute = false
	let configPath = defaultConfigPath
	let jobsRoot: string | undefined
	let stopAfter: number | undefined
	let onlyRun: number | undefined

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		if (arg === "--execute") {
			execute = true
		} else if (arg === "--dry-run") {
			execute = false
		} else if (arg === "--config") {
			configPath = argv[++index] ?? fail("--config requires a path")
		} else if (arg === "--jobs-root") {
			jobsRoot = argv[++index] ?? fail("--jobs-root requires a path")
		} else if (arg === "--stop-after") {
			stopAfter = Number(argv[++index] ?? fail("--stop-after requires a run number"))
			if (!Number.isInteger(stopAfter) || stopAfter < 1) fail("--stop-after must be a positive integer")
		} else if (arg === "--only-run") {
			onlyRun = Number(argv[++index] ?? fail("--only-run requires a run number"))
			if (!Number.isInteger(onlyRun) || onlyRun < 1) fail("--only-run must be a positive integer")
		} else if (arg === "--help" || arg === "-h") {
			console.log(`Usage: bun evals/e2e/run-cline-bench-pilot.ts [options]

Options:
  --dry-run           Validate and print the run matrix (default)
  --execute           Run paid model calls
  --config <path>     JSON configuration file
  --jobs-root <path>  Private output directory outside the repository
  --stop-after <n>    Stop cleanly after matrix run n
  --only-run <n>      Reuse prior work but execute only matrix run n
  --help              Show this help`)
			process.exit(0)
		} else {
			fail(`Unknown argument: ${arg}`)
		}
	}

	if (stopAfter && onlyRun) fail("--stop-after and --only-run cannot be combined")
	return { execute, configPath: resolve(configPath), jobsRoot, stopAfter, onlyRun }
}

function readConfig(configPath: string): PilotConfig {
	const config = JSON.parse(readFileSync(configPath, "utf8")) as PilotConfig
	if (config.routerProfile !== "cline-router" && config.routerProfile !== "cline-pass-router") {
		fail("routerProfile must be cline-router or cline-pass-router")
	}
	if (!config.provider?.trim()) fail("provider must be configured")
	if (!Number.isFinite(config.globalBudgetUsd) || config.globalBudgetUsd <= 0 || config.globalBudgetUsd >= 100) {
		fail("globalBudgetUsd must be greater than 0 and less than 100")
	}
	if (!Number.isInteger(config.maxRunsPerModel) || config.maxRunsPerModel < 1 || config.maxRunsPerModel >= 100) {
		fail("maxRunsPerModel must be an integer from 1 through 99")
	}
	if (!Number.isFinite(config.timeoutSeconds) || config.timeoutSeconds < 60 || config.timeoutSeconds > 1800) {
		fail("timeoutSeconds must be between 60 and 1800")
	}
	if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(config.clineVersion)) fail("clineVersion must be pinned")
	if (!Array.isArray(config.models) || config.models.length === 0) fail("at least one model is required")
	if (!Array.isArray(config.tasks) || config.tasks.length === 0) fail("at least one task is required")
	if (config.tasks.length > config.maxRunsPerModel) {
		fail(`configured ${config.tasks.length} tasks, exceeding maxRunsPerModel=${config.maxRunsPerModel}`)
	}

	const seenModels = new Set<string>()
	for (const model of config.models) {
		if (!model.id?.trim() || model.id.includes(":")) {
			fail(`invalid Cline model id: ${JSON.stringify(model.id)}`)
		}
		if (seenModels.has(model.id)) fail(`duplicate model: ${model.id}`)
		seenModels.add(model.id)
		if (config.routerProfile === "cline-pass-router" && !model.id.startsWith("cline-pass/")) {
			fail(`cline-pass-router model must use a public cline-pass/* id: ${model.id}`)
		}
		if (
			!Number.isFinite(model.perTaskBudgetUsd) ||
			model.perTaskBudgetUsd <= 0 ||
			model.perTaskBudgetUsd >= 100
		) {
			fail(`invalid per-task budget for ${model.id}`)
		}
		if (
			!Number.isFinite(model.perModelBudgetUsd) ||
			model.perModelBudgetUsd <= 0 ||
			model.perModelBudgetUsd >= 100
		) {
			fail(`per-model budget for ${model.id} must be greater than 0 and less than 100`)
		}
		if (model.perModelBudgetUsd > config.globalBudgetUsd) {
			fail(`per-model budget for ${model.id} exceeds the global budget`)
		}
		if (model.pricing) {
			for (const [field, value] of Object.entries(model.pricing)) {
				if (!Number.isFinite(value) || value < 0) {
					fail(`invalid ${field} pricing for ${model.id}`)
				}
			}
			if (model.pricing.inputPerMTok <= 0 || model.pricing.outputPerMTok <= 0) {
				fail(`input and output pricing must be positive for ${model.id}`)
			}
		}
	}

	for (const task of config.tasks) {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/.test(task)) fail(`invalid task id: ${JSON.stringify(task)}`)
		const taskDir = join(clineBenchDir, "tasks", task)
		if (!existsSync(join(taskDir, "task.toml")) || !existsSync(join(taskDir, "instruction.md"))) {
			fail(`task is missing or incomplete: ${task}`)
		}
	}

	return config
}

function commandExists(command: string): boolean {
	return spawnSync("which", [command], { encoding: "utf8" }).status === 0
}

function validatePrerequisites(execute: boolean) {
	if (!existsSync(clineBenchDir)) fail(`cline-bench submodule is missing: ${clineBenchDir}`)
	if (!commandExists("harbor")) fail("Harbor is not installed")
	if (!commandExists("docker")) fail("Docker is not installed")
	if (execute) {
		const docker = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 15_000 })
		if (docker.status !== 0) fail("Docker is not running")
		if (!process.env.CLINE_API_KEY?.trim()) {
			fail("CLINE_API_KEY must be inherited from the shell for --execute")
		}
	}
}

function createPrivateJobsRoot(requested?: string): string {
	const runId = new Date().toISOString().replace(/[:.]/g, "-")
	const base = requested
		? resolve(requested)
		: join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "cline-auto-sdlc-bench", runId)
	if (base === repoRoot || base.startsWith(`${repoRoot}/`)) {
		fail("jobs-root must be outside the repository")
	}
	mkdirSync(base, { recursive: true, mode: 0o700 })
	chmodSync(base, 0o700)
	return base
}

function safeEnvironment(provider: string): NodeJS.ProcessEnv {
	const allowedNames = [
		"CLINE_API_KEY",
		"DOCKER_CONFIG",
		"DOCKER_CONTEXT",
		"DOCKER_HOST",
		"HOME",
		"LANG",
		"LC_ALL",
		"PATH",
		"SSL_CERT_FILE",
		"TMPDIR",
		"XDG_RUNTIME_DIR",
	] as const
	const env: NodeJS.ProcessEnv = {}
	for (const name of allowedNames) {
		if (process.env[name]) env[name] = process.env[name]
	}
	env.HOME ||= homedir()
	env.PATH ||= process.env.PATH
	env.TMPDIR ||= tmpdir()
	// Harbor's Cline adapter has a named CLINE_API_KEY mapping for the regular
	// `cline` provider. ClinePass is a distinct CLI provider and currently
	// falls back to API_KEY, so derive that scoped alias from the same env-only
	// credential without accepting a broad host API_KEY.
	if (provider === "cline-pass" && process.env.CLINE_API_KEY) {
		env.API_KEY = process.env.CLINE_API_KEY
	}
	return env
}

function buildRunMatrix(config: PilotConfig) {
	const runs: Array<{ model: ModelConfig; task: string }> = []
	for (let round = 0; round < config.tasks.length; round += 1) {
		for (let modelIndex = 0; modelIndex < config.models.length; modelIndex += 1) {
			const taskIndex = (round + modelIndex) % config.tasks.length
			runs.push({ model: config.models[modelIndex], task: config.tasks[taskIndex] })
		}
	}
	return runs
}

function slug(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)
}

function redact(value: string, secret: string): string {
	return secret ? value.split(secret).join("[REDACTED]") : value
}

function findTrialResult(jobDir: string): any {
	for (const entry of readdirSync(jobDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const nestedResultPath = join(jobDir, entry.name, "result.json")
		if (existsSync(nestedResultPath)) return JSON.parse(readFileSync(nestedResultPath, "utf8"))
	}
	return null
}

function tokenEconomics(
	model: ModelConfig,
	inputTokens: number | null,
	cacheTokens: number | null,
	outputTokens: number | null,
) {
	const cacheReadRatio =
		inputTokens !== null && cacheTokens !== null && inputTokens > 0 ? cacheTokens / inputTokens : null
	if (
		!model.pricing ||
		inputTokens === null ||
		cacheTokens === null ||
		outputTokens === null
	) {
		return {
			cacheReadRatio,
			estimatedTokenCostUsd: null,
			coldEquivalentCostUsd: null,
			estimatedCacheSavingsUsd: null,
		}
	}
	const cached = Math.min(Math.max(cacheTokens, 0), inputTokens)
	const uncached = inputTokens - cached
	const estimatedTokenCostUsd =
		(uncached * model.pricing.inputPerMTok +
			cached * model.pricing.cachedInputPerMTok +
			outputTokens * model.pricing.outputPerMTok) /
		1_000_000
	const coldEquivalentCostUsd =
		(inputTokens * model.pricing.inputPerMTok + outputTokens * model.pricing.outputPerMTok) /
		1_000_000
	return {
		cacheReadRatio,
		estimatedTokenCostUsd,
		coldEquivalentCostUsd,
		estimatedCacheSavingsUsd: Math.max(0, coldEquivalentCostUsd - estimatedTokenCostUsd),
	}
}

function readJobResult(
	jobDir: string,
	provider: string,
	routerProfile: PilotConfig["routerProfile"],
	model: ModelConfig,
	durationSeconds: number,
): RunResult {
	const resultPath = join(jobDir, "result.json")
	if (!existsSync(resultPath)) fail(`Harbor did not write ${resultPath}`)
	const doc = JSON.parse(readFileSync(resultPath, "utf8")) as any
	const trial = doc.trial_results?.[0] || findTrialResult(jobDir)
	if (!trial) fail(`Harbor result has no nested trial: ${resultPath}`)
	const exceptionType = trial.exception_info?.exception_type
	const timedOut = exceptionType === "AgentTimeoutError"
	if (trial.exception_info && !timedOut) {
		fail(
			`Harbor trial failed with ${trial.exception_info.exception_type}: ${trial.exception_info.exception_message}`,
		)
	}

	const servedModel = trial.agent_info?.model_info?.name
	const servedProvider = trial.agent_info?.model_info?.provider
	const expectedModel = model.id
	const [expectedVendor, ...expectedNameParts] = expectedModel.split("/")
	const expectedName = expectedNameParts.join("/")
	const exactSplitMatch = servedProvider === `${provider}:${expectedVendor}` && servedModel === expectedName
	const acceptedCombinedNames = new Set([expectedModel, `${provider}:${expectedModel}`])
	if (!exactSplitMatch && !acceptedCombinedNames.has(servedModel)) {
		fail(
			`served-model mismatch: expected ${expectedModel}, result recorded provider=${JSON.stringify(servedProvider)} model=${JSON.stringify(servedModel)}`,
		)
	}

	const costUsd = doc.stats?.cost_usd
	if (!Number.isFinite(costUsd) || costUsd <= 0) {
		fail(`missing or zero cost telemetry for ${expectedModel}`)
	}

	const rewards = trial.verifier_result?.rewards
	const rewardValues = rewards && typeof rewards === "object" ? Object.values(rewards) : []
	const numericRewards = rewardValues.filter((value): value is number => typeof value === "number")
	const reward = numericRewards.length > 0 ? Math.max(...numericRewards) : null
	const trialStarted = Date.parse(trial.started_at)
	const trialFinished = Date.parse(trial.finished_at)
	const measuredDurationSeconds =
		durationSeconds > 0
			? durationSeconds
			: Number.isFinite(trialStarted) && Number.isFinite(trialFinished)
				? (trialFinished - trialStarted) / 1000
				: 0

	const inputTokens = doc.stats?.n_input_tokens ?? null
	const cacheTokens = doc.stats?.n_cache_tokens ?? null
	const outputTokens = doc.stats?.n_output_tokens ?? null
	return {
		model: expectedModel,
		task: trial.task_name,
		outcome: timedOut ? "timed_out" : reward === 1 ? "passed" : "failed",
		passed: reward === 1,
		reward,
		costUsd,
		costBasis:
			routerProfile === "cline-pass-router"
				? "cline-pass-reference-quota"
				: "reported-inference",
		durationSeconds: measuredDurationSeconds,
		inputTokens,
		cacheTokens,
		outputTokens,
		...tokenEconomics(model, inputTokens, cacheTokens, outputTokens),
		jobDir,
	}
}

function readInterruptedRun(
	jobDir: string,
	routerProfile: PilotConfig["routerProfile"],
	model: ModelConfig,
	task: string,
): RunResult {
	const rootResult = JSON.parse(readFileSync(join(jobDir, "result.json"), "utf8")) as any
	const startedAt = Date.parse(rootResult.started_at)
	let latestUsage: any = null
	let latestUsageAt: number | null = null
	for (const entry of readdirSync(jobDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const clineLog = join(jobDir, entry.name, "agent", "cline.txt")
		if (!existsSync(clineLog)) continue
		for (const line of readFileSync(clineLog, "utf8").split("\n")) {
			if (!line.startsWith("{") || !line.includes('"type":"usage"')) continue
			try {
				const parsed = JSON.parse(line)
				if (parsed.event?.type === "usage") {
					latestUsage = parsed.event
					const parsedTimestamp = Date.parse(parsed.ts)
					latestUsageAt = Number.isFinite(parsedTimestamp) ? parsedTimestamp : latestUsageAt
				}
			} catch {
				// Ignore partial JSON from a force-stopped final line.
			}
		}
	}
	const costUsd = latestUsage?.totalCost
	if (!Number.isFinite(costUsd) || costUsd <= 0) {
		fail(`interrupted run has no usable cost telemetry: ${jobDir}`)
	}
	const inputTokens = latestUsage?.totalInputTokens ?? null
	const cacheTokens = latestUsage?.totalCacheReadTokens ?? null
	const outputTokens = latestUsage?.totalOutputTokens ?? null
	return {
		model: model.id,
		task,
		outcome: "timed_out",
		passed: false,
		reward: null,
		costUsd,
		costBasis:
			routerProfile === "cline-pass-router"
				? "cline-pass-reference-quota"
				: "reported-inference",
		durationSeconds:
			Number.isFinite(startedAt) && latestUsageAt !== null ? (latestUsageAt - startedAt) / 1000 : 0,
		inputTokens,
		cacheTokens,
		outputTokens,
		...tokenEconomics(model, inputTokens, cacheTokens, outputTokens),
		jobDir,
	}
}

function taskAgentTimeoutSeconds(task: string): number {
	const taskToml = readFileSync(join(clineBenchDir, "tasks", task, "task.toml"), "utf8")
	const agentSection = taskToml.match(/\[agent\]([\s\S]*?)(?:\n\[|$)/)?.[1] || ""
	const configuredTimeout = Number(agentSection.match(/timeout_sec\s*=\s*([0-9.]+)/)?.[1])
	if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
		fail(`task ${task} has no valid [agent].timeout_sec`)
	}
	return configuredTimeout
}

function runOne(
	config: PilotConfig,
	model: ModelConfig,
	task: string,
	jobsRoot: string,
	runNumber: number,
): RunResult {
	const jobName = `${String(runNumber).padStart(2, "0")}-${slug(model.id)}-${slug(task)}`
	const jobDir = join(jobsRoot, jobName)
	const harborModel = `${config.provider}:${model.id}`
	const timeoutMultiplier = Math.min(1, config.timeoutSeconds / taskAgentTimeoutSeconds(task))
	const args = [
		"run",
		"-p",
		`tasks/${task}`,
		"-a",
		"cline-cli",
		"-m",
		harborModel,
		"--env",
		"docker",
		"-n",
		"1",
		"-k",
		"1",
		"--max-retries",
		"0",
		"--agent-timeout-multiplier",
		timeoutMultiplier.toFixed(6),
		"--ak",
		`timeout=${config.timeoutSeconds}`,
		"--ak",
		`cline-version=${config.clineVersion}`,
		"--job-name",
		jobName,
		"--jobs-dir",
		jobsRoot,
		"--yes",
	]

	console.log(`\n[${runNumber}] ${model.id} × ${task}`)
	const started = Date.now()
	const result = spawnSync("harbor", args, {
		cwd: clineBenchDir,
		env: safeEnvironment(config.provider),
		encoding: "utf8",
		timeout: (config.timeoutSeconds + 15 * 60) * 1000,
		maxBuffer: 20 * 1024 * 1024,
	})
	const durationSeconds = (Date.now() - started) / 1000
	const secret = process.env.CLINE_API_KEY || ""
	const sanitizedOutput = redact(`${result.stdout || ""}\n${result.stderr || ""}`, secret)
	mkdirSync(jobDir, { recursive: true, mode: 0o700 })
	writeFileSync(join(jobDir, "harbor-console.log"), sanitizedOutput, { mode: 0o600 })

	if (result.error) fail(`Harbor failed for ${model.id} × ${task}: ${result.error.message}`)
	if (result.status !== 0) {
		const tail = sanitizedOutput.trim().split("\n").slice(-20).join("\n")
		fail(`Harbor exited ${result.status} for ${model.id} × ${task}\n${tail}`)
	}
	return readJobResult(jobDir, config.provider, config.routerProfile, model, durationSeconds)
}

function reuseCompletedRun(
	config: PilotConfig,
	model: ModelConfig,
	task: string,
	jobsRoot: string,
	runNumber: number,
): RunResult | null {
	const jobName = `${String(runNumber).padStart(2, "0")}-${slug(model.id)}-${slug(task)}`
	const jobDir = join(jobsRoot, jobName)
	if (!existsSync(join(jobDir, "result.json"))) return null
	const rootResult = JSON.parse(readFileSync(join(jobDir, "result.json"), "utf8")) as any
	if (!rootResult.finished_at && rootResult.stats?.n_running_trials > 0) {
		const interrupted = readInterruptedRun(jobDir, config.routerProfile, model, task)
		console.log(`\n[${runNumber}] recording interrupted ${model.id} × ${task} as timed out`)
		console.log(`  cost=$${interrupted.costUsd.toFixed(4)}`)
		return interrupted
	}
	const result = readJobResult(jobDir, config.provider, config.routerProfile, model, 0)
	console.log(`\n[${runNumber}] reusing completed ${model.id} × ${task}`)
	console.log(`  outcome=${result.outcome} reward=${result.reward ?? "missing"} cost=$${result.costUsd.toFixed(4)}`)
	return result
}

function writeReport(report: PilotReport) {
	writeFileSync(join(report.jobsRoot, "pilot-report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
}

function printMatrix(config: PilotConfig) {
	console.log(`Router profile: ${config.routerProfile}`)
	console.log(`Provider: ${config.provider}`)
	console.log(
		`Limits: ${config.maxRunsPerModel} runs/model, $${config.globalBudgetUsd.toFixed(2)} global, ${config.timeoutSeconds}s/task`,
	)
	for (const model of config.models) {
		console.log(
			`  ${model.id}: $${model.perTaskBudgetUsd.toFixed(2)}/task stop, $${model.perModelBudgetUsd.toFixed(2)}/model stop`,
		)
	}
	console.log("Latin-square run order:")
	for (const [index, run] of buildRunMatrix(config).entries()) {
		console.log(`  ${index + 1}. ${run.model.id} × ${run.task}`)
	}
}

function main() {
	const args = parseArgs(process.argv.slice(2))
	const config = readConfig(args.configPath)
	validatePrerequisites(args.execute)
	printMatrix(config)
	if (!args.execute) {
		console.log("\nDry run complete. No model was called. Pass --execute to spend.")
		return
	}

	const jobsRoot = createPrivateJobsRoot(args.jobsRoot)
	const report: PilotReport = {
		startedAt: new Date().toISOString(),
		mode: "execute",
		config,
		jobsRoot,
		results: [],
	}
	const modelSpend = new Map(config.models.map((model) => [model.id, 0]))
	let globalSpend = 0

	try {
		for (const [index, run] of buildRunMatrix(config).entries()) {
			if (args.stopAfter && index + 1 > args.stopAfter) {
				report.stoppedReason = `operator stop-after ${args.stopAfter}`
				break
			}
			const reused = reuseCompletedRun(config, run.model, run.task, jobsRoot, index + 1)
			if (reused) {
				report.results.push(reused)
				modelSpend.set(run.model.id, (modelSpend.get(run.model.id) || 0) + reused.costUsd)
				globalSpend += reused.costUsd
				writeReport(report)
				continue
			}
			if (args.onlyRun && index + 1 !== args.onlyRun) continue
			const currentModelSpend = modelSpend.get(run.model.id) || 0
			if (currentModelSpend >= run.model.perModelBudgetUsd) {
				fail(`${run.model.id} reached its $${run.model.perModelBudgetUsd.toFixed(2)} model budget`)
			}
			if (globalSpend >= config.globalBudgetUsd) {
				fail(`pilot reached its $${config.globalBudgetUsd.toFixed(2)} global budget`)
			}

			const result = runOne(config, run.model, run.task, jobsRoot, index + 1)
			report.results.push(result)
			modelSpend.set(run.model.id, currentModelSpend + result.costUsd)
			globalSpend += result.costUsd
			writeReport(report)
			console.log(
				`  outcome=${result.outcome} reward=${result.reward ?? "missing"} cost=$${result.costUsd.toFixed(4)} duration=${result.durationSeconds.toFixed(1)}s`,
			)

			if (result.costUsd > run.model.perTaskBudgetUsd) {
				fail(
					`${run.model.id} exceeded its $${run.model.perTaskBudgetUsd.toFixed(2)} per-task stop after ${run.task}`,
				)
			}
			if ((modelSpend.get(run.model.id) || 0) > run.model.perModelBudgetUsd) {
				fail(`${run.model.id} exceeded its $${run.model.perModelBudgetUsd.toFixed(2)} model budget`)
			}
			if (globalSpend > config.globalBudgetUsd) {
				fail(`pilot exceeded its $${config.globalBudgetUsd.toFixed(2)} global budget`)
			}
		}
		if (args.onlyRun) report.stoppedReason = `operator only-run ${args.onlyRun}`
	} catch (error) {
		report.stoppedReason = error instanceof Error ? error.message : String(error)
		throw error
	} finally {
		report.finishedAt = new Date().toISOString()
		writeReport(report)
		console.log(`\nReport: ${join(jobsRoot, "pilot-report.json")}`)
	}
}

main()
