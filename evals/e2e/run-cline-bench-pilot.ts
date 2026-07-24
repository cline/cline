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

import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
	acquireRunLock,
	type BudgetLedger,
	createBudgetLedger,
	hashPrivateIdentifier,
	ledgerExposure,
	MAX_CHECKPOINT_USD,
	normalizeLocalCoreUrl,
	parseRouteTraces,
	type RouteTrace,
	recoverLatestUsage,
	redactSecrets,
	releaseRunLock,
	reserveBudget,
	settleBudget,
	sha256,
} from "./cline-bench-safety"

type ModelConfig = {
	id: string
	perTaskBudgetUsd: number
	perModelBudgetUsd: number
	tasks?: string[]
	wave?: number
	allowedCandidates?: string[]
	pricing?: {
		inputPerMTok: number
		cachedInputPerMTok: number
		outputPerMTok: number
	}
}

export type PilotConfig = {
	routerProfile: "cline-router" | "cline-pass-router"
	provider: string
	globalBudgetUsd: number
	maxRunsPerModel: number
	timeoutSeconds: number
	clineVersion: string
	models: ModelConfig[]
	tasks: string[]
	waveBudgetsUsd?: Record<string, number>
}

export type ExecutionProvenance = {
	schemaVersion: 3
	runnerContentSha256: string
	runnerGitCommit: string
	harborVersion: string
	effectiveConfig: PilotConfig
	executionOptions: {
		localCoreUrl: string | null
	}
	clineBenchCommit: string
	tasks: Array<{
		id: string
		effectiveContentSha256: string
	}>
}

type RunResult = {
	model: string
	requestedModel: string
	task: string
	taskHash: string
	sessionHash: string | null
	sessionIdSha256: string | null
	routeTraces: RouteTrace[]
	routeEvidence: "not-applicable" | "verified" | "missing"
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
	executionFingerprint: string
	executionProvenance: ExecutionProvenance
	jobsRoot: string
	budgetLedger: BudgetLedger
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
	let wave: number | undefined
	let localCoreUrl: string | undefined
	let routeTracesPath: string | undefined
	let ingestRouteTraces = false

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
		} else if (arg === "--wave") {
			wave = Number(argv[++index] ?? fail("--wave requires a wave number"))
			if (!Number.isInteger(wave) || wave < 1) fail("--wave must be a positive integer")
		} else if (arg === "--local-core-url") {
			localCoreUrl = normalizeLocalCoreUrl(argv[++index] ?? fail("--local-core-url requires a URL"))
		} else if (arg === "--route-traces") {
			routeTracesPath = resolve(argv[++index] ?? fail("--route-traces requires a path"))
		} else if (arg === "--ingest-route-traces") {
			ingestRouteTraces = true
		} else if (arg === "--help" || arg === "-h") {
			console.log(`Usage: bun evals/e2e/run-cline-bench-pilot.ts [options]

Options:
  --dry-run           Validate and print the run matrix (default)
  --execute           Run paid model calls
  --config <path>     JSON configuration file
  --jobs-root <path>  Private output directory outside the repository
  --stop-after <n>    Stop cleanly after matrix run n
  --only-run <n>      Reuse prior work but execute only matrix run n
  --wave <n>          Execute only the selected staged wave
  --local-core-url    Local Core URL (strictly localhost:7777)
  --route-traces      Privacy-safe Core route trace JSON/JSONL
  --ingest-route-traces
                      Attach traces to an existing report without model calls
  --help              Show this help`)
			process.exit(0)
		} else {
			fail(`Unknown argument: ${arg}`)
		}
	}

	if (stopAfter && onlyRun) fail("--stop-after and --only-run cannot be combined")
	if (ingestRouteTraces && execute) fail("--ingest-route-traces cannot be combined with --execute")
	if (ingestRouteTraces && !routeTracesPath) fail("--ingest-route-traces requires --route-traces")
	if (ingestRouteTraces && !jobsRoot) fail("--ingest-route-traces requires --jobs-root")
	if (execute && !jobsRoot) fail("--execute requires an explicit --jobs-root")
	return {
		execute,
		configPath: resolve(configPath),
		jobsRoot,
		stopAfter,
		onlyRun,
		wave,
		localCoreUrl,
		routeTracesPath,
		ingestRouteTraces,
	}
}

function assertOnlyKeys(
	value: unknown,
	allowed: readonly string[],
	label: string,
): asserts value is Record<string, any> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`)
	const allowlist = new Set(allowed)
	for (const key of Object.keys(value)) {
		if (!allowlist.has(key)) fail(`unknown ${label} field: ${key}`)
	}
}

export function readConfig(configPath: string): PilotConfig {
	const raw: unknown = JSON.parse(readFileSync(configPath, "utf8"))
	assertOnlyKeys(
		raw,
		[
			"routerProfile",
			"provider",
			"globalBudgetUsd",
			"maxRunsPerModel",
			"timeoutSeconds",
			"clineVersion",
			"models",
			"tasks",
			"waveBudgetsUsd",
		],
		"config",
	)
	if (!Array.isArray(raw.models) || raw.models.length === 0) fail("at least one model is required")
	if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) fail("at least one task is required")
	const models = raw.models.map((value, index): ModelConfig => {
		assertOnlyKeys(
			value,
			["id", "perTaskBudgetUsd", "perModelBudgetUsd", "pricing", "tasks", "wave", "allowedCandidates"],
			`models[${index}]`,
		)
		let pricing: ModelConfig["pricing"]
		if (value.pricing !== undefined) {
			assertOnlyKeys(value.pricing, ["inputPerMTok", "cachedInputPerMTok", "outputPerMTok"], `models[${index}].pricing`)
			pricing = {
				inputPerMTok: value.pricing.inputPerMTok,
				cachedInputPerMTok: value.pricing.cachedInputPerMTok,
				outputPerMTok: value.pricing.outputPerMTok,
			}
		}
		return {
			id: value.id,
			perTaskBudgetUsd: value.perTaskBudgetUsd,
			perModelBudgetUsd: value.perModelBudgetUsd,
			...(value.tasks !== undefined ? { tasks: value.tasks } : {}),
			...(value.wave !== undefined ? { wave: value.wave } : {}),
			...(value.allowedCandidates !== undefined ? { allowedCandidates: value.allowedCandidates } : {}),
			...(pricing ? { pricing } : {}),
		}
	})
	const config: PilotConfig = {
		routerProfile: raw.routerProfile,
		provider: raw.provider,
		globalBudgetUsd: raw.globalBudgetUsd,
		maxRunsPerModel: raw.maxRunsPerModel,
		timeoutSeconds: raw.timeoutSeconds,
		clineVersion: raw.clineVersion,
		models,
		tasks: [...raw.tasks],
		...(raw.waveBudgetsUsd !== undefined ? { waveBudgetsUsd: raw.waveBudgetsUsd } : {}),
	}
	if (config.routerProfile !== "cline-router" && config.routerProfile !== "cline-pass-router") {
		fail("routerProfile must be cline-router or cline-pass-router")
	}
	const expectedProvider = config.routerProfile === "cline-pass-router" ? "cline-pass" : "cline"
	if (config.provider !== expectedProvider) {
		fail(`${config.routerProfile} requires provider=${expectedProvider}`)
	}
	if (
		!Number.isFinite(config.globalBudgetUsd) ||
		config.globalBudgetUsd <= 0 ||
		config.globalBudgetUsd > MAX_CHECKPOINT_USD
	) {
		fail(`globalBudgetUsd must be greater than 0 and at most ${MAX_CHECKPOINT_USD}`)
	}
	if (!Number.isInteger(config.maxRunsPerModel) || config.maxRunsPerModel < 1 || config.maxRunsPerModel >= 100) {
		fail("maxRunsPerModel must be an integer from 1 through 99")
	}
	if (!Number.isFinite(config.timeoutSeconds) || config.timeoutSeconds < 60 || config.timeoutSeconds > 1800) {
		fail("timeoutSeconds must be between 60 and 1800")
	}
	if (typeof config.clineVersion !== "string" || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(config.clineVersion)) {
		fail("clineVersion must be pinned")
	}
	const seenModels = new Set<string>()
	for (const model of config.models) {
		if (typeof model.id !== "string" || !model.id.trim() || model.id.includes(":")) {
			fail(`invalid Cline model id: ${JSON.stringify(model.id)}`)
		}
		if (seenModels.has(model.id)) fail(`duplicate model: ${model.id}`)
		seenModels.add(model.id)
		if (config.routerProfile === "cline-pass-router" && !model.id.startsWith("cline-pass/")) {
			fail(`cline-pass-router model must use a public cline-pass/* id: ${model.id}`)
		}
		const modelTasks = model.tasks ?? config.tasks
		if (
			!Array.isArray(modelTasks) ||
			modelTasks.length === 0 ||
			modelTasks.some((task) => typeof task !== "string" || !config.tasks.includes(task))
		) {
			fail(`tasks for ${model.id} must be a non-empty subset of config.tasks`)
		}
		if (new Set(modelTasks).size !== modelTasks.length) fail(`duplicate task configured for ${model.id}`)
		if (modelTasks.length > config.maxRunsPerModel) {
			fail(`${model.id} has ${modelTasks.length} tasks, exceeding maxRunsPerModel=${config.maxRunsPerModel}`)
		}
		if (model.wave !== undefined && (!Number.isInteger(model.wave) || model.wave < 1)) {
			fail(`wave for ${model.id} must be a positive integer`)
		}
		const isVirtual = model.id === "cline/auto" || model.id === "cline-pass/auto"
		if (isVirtual) {
			if (!Array.isArray(model.allowedCandidates) || model.allowedCandidates.length === 0) {
				fail(`virtual model ${model.id} requires allowedCandidates`)
			}
			if (
				model.allowedCandidates.some(
					(candidate) =>
						typeof candidate !== "string" ||
						!candidate ||
						(config.routerProfile === "cline-pass-router"
							? !candidate.startsWith("cline-pass/")
							: candidate.startsWith("cline-pass/")),
				)
			) {
				fail(`virtual model ${model.id} has an invalid cross-product candidate`)
			}
		} else if (model.allowedCandidates !== undefined) {
			fail(`fixed model ${model.id} cannot declare allowedCandidates`)
		}
		if (!Number.isFinite(model.perTaskBudgetUsd) || model.perTaskBudgetUsd <= 0 || model.perTaskBudgetUsd >= 100) {
			fail(`invalid per-task budget for ${model.id}`)
		}
		if (!Number.isFinite(model.perModelBudgetUsd) || model.perModelBudgetUsd <= 0 || model.perModelBudgetUsd >= 100) {
			fail(`per-model budget for ${model.id} must be greater than 0 and less than 100`)
		}
		if (model.perModelBudgetUsd > config.globalBudgetUsd) {
			fail(`per-model budget for ${model.id} exceeds the global budget`)
		}
		if (model.perTaskBudgetUsd > model.perModelBudgetUsd) {
			fail(`per-task budget for ${model.id} exceeds its model budget`)
		}
		if (model.perTaskBudgetUsd > config.globalBudgetUsd) {
			fail(`per-task budget for ${model.id} exceeds the global budget`)
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
	if (config.waveBudgetsUsd !== undefined) {
		assertOnlyKeys(
			config.waveBudgetsUsd,
			[...new Set(config.models.map((model) => String(model.wave ?? 1)))],
			"waveBudgetsUsd",
		)
		for (const [wave, budget] of Object.entries(config.waveBudgetsUsd)) {
			if (!/^[1-9][0-9]*$/.test(wave) || !Number.isFinite(budget) || budget <= 0 || budget > config.globalBudgetUsd) {
				fail(`invalid wave budget for wave ${wave}`)
			}
		}
	}

	for (const task of config.tasks) {
		if (typeof task !== "string") fail(`invalid task id: ${JSON.stringify(task)}`)
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
		const docker = spawnSync("docker", ["info"], {
			stdio: "ignore",
			timeout: 15_000,
		})
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
	mkdirSync(base, { recursive: true, mode: 0o700 })
	const canonicalBase = realpathSync(base)
	const canonicalRepoRoot = realpathSync(repoRoot)
	if (canonicalBase === canonicalRepoRoot || canonicalBase.startsWith(`${canonicalRepoRoot}/`)) {
		fail("jobs-root must be outside the repository")
	}
	chmodSync(canonicalBase, 0o700)
	return canonicalBase
}

function appendHashField(hash: ReturnType<typeof createHash>, value: string | Uint8Array) {
	hash.update(String(typeof value === "string" ? Buffer.byteLength(value) : value.byteLength))
	hash.update(":")
	hash.update(value)
}

// Hash the exact directory tree Harbor receives. Relative names, entry types,
// executable bits, symlink targets, and file bytes are framed separately so
// renames and concatenation ambiguities cannot collide accidentally.
export function hashDirectoryTree(root: string): string {
	if (!existsSync(root) || !lstatSync(root).isDirectory()) {
		fail(`cannot fingerprint missing task directory: ${root}`)
	}
	const hash = createHash("sha256")

	function visit(directory: string, relativeDirectory: string) {
		const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
			left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
		)
		for (const entry of entries) {
			const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
			const absolutePath = join(directory, entry.name)
			if (entry.isDirectory()) {
				appendHashField(hash, "directory")
				appendHashField(hash, relativePath)
				visit(absolutePath, relativePath)
			} else if (entry.isFile()) {
				const content = readFileSync(absolutePath)
				appendHashField(hash, "file")
				appendHashField(hash, relativePath)
				appendHashField(hash, String(lstatSync(absolutePath).mode & 0o111))
				appendHashField(hash, content)
			} else if (entry.isSymbolicLink()) {
				appendHashField(hash, "symlink")
				appendHashField(hash, relativePath)
				appendHashField(hash, readlinkSync(absolutePath))
			} else {
				fail(`cannot fingerprint unsupported task entry: ${absolutePath}`)
			}
		}
	}

	visit(root, "")
	return hash.digest("hex")
}

export function fingerprintExecution(config: PilotConfig, provenance: ExecutionProvenance): string {
	const executionConfig = {
		fingerprintSchemaVersion: provenance.schemaVersion,
		effectiveConfig: config,
		runnerContentSha256: provenance.runnerContentSha256,
		runnerGitCommit: provenance.runnerGitCommit,
		harborVersion: provenance.harborVersion,
		executionOptions: provenance.executionOptions,
		clineBenchCommit: provenance.clineBenchCommit,
		effectiveTasks: provenance.tasks,
	}
	return createHash("sha256").update(JSON.stringify(executionConfig)).digest("hex")
}

export function assertReusableFingerprint(existing: Partial<PilotReport>, expectedFingerprint: string) {
	if (!existing.executionFingerprint) {
		fail("jobs-root report predates content-addressed task fingerprints; use a new jobs-root")
	}
	if (existing.executionFingerprint !== expectedFingerprint) {
		fail("jobs-root belongs to a different execution matrix, cline-bench commit, or effective task corpus")
	}
}

function readClineBenchCommit(): string {
	const result = spawnSync("git", ["-C", clineBenchDir, "rev-parse", "--verify", "HEAD^{commit}"], {
		encoding: "utf8",
		env: infrastructureEnvironment(),
	})
	const commit = (result.stdout || "").trim()
	if (result.status !== 0 || !/^[0-9a-f]{40,64}$/.test(commit)) {
		fail(`could not resolve exact cline-bench submodule commit: ${(result.stderr || "").trim() || "unknown error"}`)
	}
	return commit
}

function commandOutput(command: string, args: string[], label: string, pattern: RegExp): string {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		env: infrastructureEnvironment(),
	})
	const value = (result.stdout || "").trim()
	if (result.status !== 0 || !pattern.test(value)) {
		fail(`could not resolve ${label}: ${(result.stderr || "").trim() || "unknown error"}`)
	}
	return value
}

function executionIdentity(config: PilotConfig, jobsRoot: string, localCoreUrl?: string) {
	const provenance: ExecutionProvenance = {
		schemaVersion: 3,
		runnerContentSha256: sha256(
			`${readFileSync(fileURLToPath(import.meta.url), "utf8")}\0${readFileSync(join(scriptDir, "cline-bench-safety.ts"), "utf8")}`,
		),
		runnerGitCommit: commandOutput(
			"git",
			["-C", repoRoot, "rev-parse", "HEAD"],
			"runner git commit",
			/^[0-9a-f]{40,64}$/,
		),
		harborVersion: commandOutput("harbor", ["--version"], "Harbor version", /^[0-9]+\.[0-9]+\.[0-9]+/),
		effectiveConfig: config,
		executionOptions: {
			localCoreUrl: localCoreUrl ?? null,
		},
		clineBenchCommit: readClineBenchCommit(),
		tasks: config.tasks.map((task) => {
			const taskPath = prepareTaskPath(task, jobsRoot)
			const effectivePath = isAbsolute(taskPath) ? taskPath : join(clineBenchDir, taskPath)
			return {
				id: task,
				effectiveContentSha256: hashDirectoryTree(effectivePath),
			}
		}),
	}
	return {
		fingerprint: fingerprintExecution(config, provenance),
		provenance,
	}
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

function infrastructureEnvironment(): NodeJS.ProcessEnv {
	const env = safeEnvironment("cline")
	delete env.CLINE_API_KEY
	delete env.API_KEY
	return env
}

function cleanupJobContainers(jobDir: string): string[] {
	if (!existsSync(jobDir)) return []
	const trialNames = readdirSync(jobDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name.includes("__"))
		.map((entry) => entry.name.toLowerCase())
	if (trialNames.length === 0) return []
	const listed = spawnSync("docker", ["ps", "-a", "--format", "{{.ID}}\t{{.Names}}"], {
		env: infrastructureEnvironment(),
		encoding: "utf8",
		timeout: 15_000,
	})
	if (listed.status !== 0) return []
	const removed: string[] = []
	for (const line of listed.stdout.split("\n")) {
		const [id, name] = line.trim().split("\t")
		if (!/^[0-9a-f]{12,64}$/.test(id || "") || !name) continue
		if (!trialNames.some((trialName) => name.toLowerCase().includes(trialName))) continue
		const cleanup = spawnSync("docker", ["rm", "-f", id], {
			env: infrastructureEnvironment(),
			stdio: "ignore",
			timeout: 30_000,
		})
		if (cleanup.status === 0) removed.push(id)
	}
	return removed
}

function cleanupJobsRootContainers(jobsRoot: string): string[] {
	const removed = new Set<string>()
	if (!existsSync(jobsRoot)) return []
	for (const entry of readdirSync(jobsRoot, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue
		for (const id of cleanupJobContainers(join(jobsRoot, entry.name))) removed.add(id)
	}
	return [...removed]
}

export function buildRunMatrix(config: PilotConfig) {
	const runs: Array<{ model: ModelConfig; task: string; wave: number }> = []
	const longestArm = Math.max(...config.models.map((model) => (model.tasks ?? config.tasks).length))
	for (let round = 0; round < longestArm; round += 1) {
		for (let modelIndex = 0; modelIndex < config.models.length; modelIndex += 1) {
			const model = config.models[modelIndex]
			const modelTasks = model.tasks ?? config.tasks
			if (round >= modelTasks.length) continue
			const taskIndex = (round + modelIndex) % modelTasks.length
			runs.push({ model, task: modelTasks[taskIndex], wave: model.wave ?? 1 })
		}
	}
	return runs
}

function slug(value: string): string {
	return value
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80)
}

function findTrialResult(jobDir: string): { document: any; trialName: string } | null {
	const matches: Array<{ document: any; trialName: string }> = []
	for (const entry of readdirSync(jobDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const nestedResultPath = join(jobDir, entry.name, "result.json")
		if (existsSync(nestedResultPath)) {
			matches.push({
				document: JSON.parse(readFileSync(nestedResultPath, "utf8")),
				trialName: entry.name,
			})
		}
	}
	if (matches.length > 1) fail(`job contains ambiguous multiple trial attempts: ${jobDir}`)
	return matches[0] ?? null
}

export function readTrialSessionIdentity(
	jobDir: string,
	trialName: string,
): { sessionHash: string; sessionIdSha256: string } | null {
	const trajectoryPath = join(jobDir, trialName, "agent", "trajectory.json")
	if (!existsSync(trajectoryPath)) return null
	const trajectory = JSON.parse(readFileSync(trajectoryPath, "utf8")) as { session_id?: unknown }
	if (typeof trajectory.session_id !== "string" || trajectory.session_id.length === 0) {
		fail(`trajectory has no valid session_id: ${trajectoryPath}`)
	}
	return {
		sessionHash: hashPrivateIdentifier("cline-bench-session", trajectory.session_id),
		sessionIdSha256: sha256(trajectory.session_id),
	}
}

function tokenEconomics(
	model: ModelConfig,
	inputTokens: number | null,
	cacheTokens: number | null,
	outputTokens: number | null,
) {
	const cacheReadRatio =
		inputTokens !== null && cacheTokens !== null && inputTokens > 0 ? cacheTokens / inputTokens : null
	if (!model.pricing || inputTokens === null || cacheTokens === null || outputTokens === null) {
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
		(inputTokens * model.pricing.inputPerMTok + outputTokens * model.pricing.outputPerMTok) / 1_000_000
	return {
		cacheReadRatio,
		estimatedTokenCostUsd,
		coldEquivalentCostUsd,
		estimatedCacheSavingsUsd: Math.max(0, coldEquivalentCostUsd - estimatedTokenCostUsd),
	}
}

function readJobResult(
	jobDir: string,
	config: PilotConfig,
	model: ModelConfig,
	expectedTask: string,
	durationSeconds: number,
): RunResult {
	const resultPath = join(jobDir, "result.json")
	if (!existsSync(resultPath)) fail(`Harbor did not write ${resultPath}`)
	const doc = JSON.parse(readFileSync(resultPath, "utf8")) as any
	const nestedTrial = findTrialResult(jobDir)
	const trial = doc.trial_results?.[0] || nestedTrial?.document
	if (!trial) fail(`Harbor result has no nested trial: ${resultPath}`)
	const exceptionType = trial.exception_info?.exception_type
	const timedOut = exceptionType === "AgentTimeoutError"
	if (trial.exception_info && !timedOut) {
		fail(`Harbor trial failed with ${trial.exception_info.exception_type}: ${trial.exception_info.exception_message}`)
	}
	if (trial.task_name !== expectedTask) {
		fail(`task mismatch: expected ${expectedTask}, result recorded ${JSON.stringify(trial.task_name)}`)
	}
	if (trial.agent_info?.version !== config.clineVersion) {
		fail(
			`Cline version mismatch: expected ${config.clineVersion}, result recorded ${JSON.stringify(trial.agent_info?.version)}`,
		)
	}

	const servedModel = trial.agent_info?.model_info?.name
	const servedProvider = trial.agent_info?.model_info?.provider
	const expectedModel = model.id
	const [expectedVendor, ...expectedNameParts] = expectedModel.split("/")
	const expectedName = expectedNameParts.join("/")
	const exactSplitMatch = servedProvider === `${config.provider}:${expectedVendor}` && servedModel === expectedName
	const acceptedCombinedNames = new Set([expectedModel, `${config.provider}:${expectedModel}`])
	const combinedMatch = servedProvider === config.provider && acceptedCombinedNames.has(servedModel)
	const virtualModel = expectedModel === "cline/auto" || expectedModel === "cline-pass/auto"
	const requestedVirtualMatch =
		virtualModel &&
		((servedProvider === `${config.provider}:cline` && servedModel === "auto") ||
			(servedProvider === config.provider && acceptedCombinedNames.has(servedModel)))
	if (!exactSplitMatch && !combinedMatch && !requestedVirtualMatch) {
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
	const sessionIdentity = nestedTrial ? readTrialSessionIdentity(jobDir, nestedTrial.trialName) : null
	return {
		model: expectedModel,
		requestedModel: expectedModel,
		task: trial.task_name,
		taskHash: hashPrivateIdentifier("cline-bench-task", trial.task_name),
		sessionHash: sessionIdentity?.sessionHash ?? null,
		sessionIdSha256: sessionIdentity?.sessionIdSha256 ?? null,
		routeTraces: [],
		routeEvidence: virtualModel ? "missing" : "not-applicable",
		outcome: timedOut ? "timed_out" : reward === 1 ? "passed" : "failed",
		passed: reward === 1,
		reward,
		costUsd,
		costBasis: config.routerProfile === "cline-pass-router" ? "cline-pass-reference-quota" : "reported-inference",
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
	const logDocuments: string[] = []
	let trialName: string | null = null
	for (const entry of readdirSync(jobDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const clineLog = join(jobDir, entry.name, "agent", "cline.txt")
		if (!existsSync(clineLog)) continue
		logDocuments.push(readFileSync(clineLog, "utf8"))
		trialName = entry.name
	}
	const latestUsage = recoverLatestUsage(logDocuments)
	const costUsd = latestUsage.totalCost
	const inputTokens = latestUsage.totalInputTokens
	const cacheTokens = latestUsage.totalCacheReadTokens
	const outputTokens = latestUsage.totalOutputTokens
	const virtualModel = model.id === "cline/auto" || model.id === "cline-pass/auto"
	const sessionIdentity = trialName ? readTrialSessionIdentity(jobDir, trialName) : null
	return {
		model: model.id,
		requestedModel: model.id,
		task,
		taskHash: hashPrivateIdentifier("cline-bench-task", task),
		sessionHash: sessionIdentity?.sessionHash ?? null,
		sessionIdSha256: sessionIdentity?.sessionIdSha256 ?? null,
		routeTraces: [],
		routeEvidence: virtualModel ? "missing" : "not-applicable",
		outcome: "timed_out",
		passed: false,
		reward: null,
		costUsd,
		costBasis: routerProfile === "cline-pass-router" ? "cline-pass-reference-quota" : "reported-inference",
		durationSeconds: Number.isFinite(startedAt) ? (Date.parse(latestUsage.timestamp) - startedAt) / 1000 : 0,
		inputTokens,
		cacheTokens,
		outputTokens,
		...tokenEconomics(model, inputTokens, cacheTokens, outputTokens),
		jobDir,
	}
}

export function matchRouteTraces(
	traces: readonly RouteTrace[],
	identity: {
		requestedModel: string
		taskHash: string
		sessionHash: string | null
		sessionIdSha256: string | null
	},
): RouteTrace[] {
	return traces.filter(
		(trace) =>
			trace.requestedModel === identity.requestedModel &&
			(trace.source === "core"
				? Boolean(identity.sessionIdSha256) && trace.taskIdSha256 === identity.sessionIdSha256
				: trace.taskHash === identity.taskHash &&
					(!trace.sessionHash || !identity.sessionHash || trace.sessionHash === identity.sessionHash)),
	)
}

function attachRouteEvidence(result: RunResult, model: ModelConfig, traces: readonly RouteTrace[]): RunResult {
	result = {
		...result,
		requestedModel: result.requestedModel || result.model,
		taskHash: result.taskHash || hashPrivateIdentifier("cline-bench-task", result.task),
		sessionHash: result.sessionHash ?? null,
		sessionIdSha256: result.sessionIdSha256 ?? null,
		routeTraces: result.routeTraces || [],
		routeEvidence: result.routeEvidence || "not-applicable",
	}
	const virtualModel = model.id === "cline/auto" || model.id === "cline-pass/auto"
	if (!virtualModel) return { ...result, routeTraces: [], routeEvidence: "not-applicable" }
	const matched = matchRouteTraces(traces, result)
	const allowedCandidates = new Set(model.allowedCandidates || [])
	for (const trace of matched) {
		if (!allowedCandidates.has(trace.selectedModel)) {
			fail(`route trace selected disallowed candidate ${trace.selectedModel} for ${model.id} × ${result.task}`)
		}
	}
	return {
		...result,
		routeTraces: [...matched].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)),
		routeEvidence: matched.length > 0 ? "verified" : "missing",
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

export function prepareTaskPath(task: string, jobsRoot: string): string {
	void jobsRoot
	return `tasks/${task}`
}

// All eight selected verifiers invoke uv, but their task images expose its
// install directory inconsistently. Harbor's verifier-only environment flag
// fixes PATH uniformly without changing the agent environment or task corpus.
export function verifierHarborArguments(): string[] {
	return ["--ve", "PATH=/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"]
}

type HarborProcessResult = {
	status: number | null
	stdout: string
	stderr: string
	timedOut: boolean
	signal: NodeJS.Signals | null
}

export function localCoreHarborArguments(localCoreUrl?: string): string[] {
	if (!localCoreUrl) return []
	const normalized = normalizeLocalCoreUrl(localCoreUrl)
	return [
		"--ae",
		`CLINE_API_BASE_URL=${normalized}`,
		"--allow-agent-host",
		"host.docker.internal",
		"--allow-environment-host",
		"host.docker.internal",
	]
}

async function runHarborProcess(args: string[], config: PilotConfig): Promise<HarborProcessResult> {
	const child = spawn("harbor", args, {
		cwd: clineBenchDir,
		env: safeEnvironment(config.provider),
		detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "pipe"],
	})
	const maxBuffer = 20 * 1024 * 1024
	const stdoutChunks: Buffer[] = []
	const stderrChunks: Buffer[] = []
	let stdoutBytes = 0
	let stderrBytes = 0
	const append = (chunks: Buffer[], chunk: Buffer, current: number) => {
		if (current >= maxBuffer) return current
		const remaining = maxBuffer - current
		chunks.push(chunk.subarray(0, remaining))
		return current + Math.min(chunk.length, remaining)
	}
	child.stdout.on("data", (chunk: Buffer) => {
		stdoutBytes = append(stdoutChunks, chunk, stdoutBytes)
	})
	child.stderr.on("data", (chunk: Buffer) => {
		stderrBytes = append(stderrChunks, chunk, stderrBytes)
	})

	const terminateGroup = (signal: NodeJS.Signals) => {
		if (!child.pid) return
		try {
			if (process.platform === "win32") child.kill(signal)
			else process.kill(-child.pid, signal)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
		}
	}
	let timedOut = false
	let interruptedSignal: NodeJS.Signals | null = null
	let forceKillTimeout: NodeJS.Timeout | undefined
	const onSignal = (signal: NodeJS.Signals) => {
		interruptedSignal = signal
		terminateGroup("SIGTERM")
		forceKillTimeout ||= setTimeout(() => terminateGroup("SIGKILL"), 5_000)
		forceKillTimeout.unref()
	}
	const signalHandlers = (["SIGINT", "SIGTERM", "SIGHUP"] as const).map((signal) => {
		const handler = () => onSignal(signal)
		process.once(signal, handler)
		return { signal, handler }
	})
	const timeout = setTimeout(
		() => {
			timedOut = true
			terminateGroup("SIGTERM")
			forceKillTimeout = setTimeout(() => terminateGroup("SIGKILL"), 5_000)
			forceKillTimeout.unref()
		},
		(config.timeoutSeconds + 15 * 60) * 1000,
	)
	timeout.unref()
	let outcome: { status: number | null; signal: NodeJS.Signals | null } | undefined
	try {
		outcome = await new Promise<{
			status: number | null
			signal: NodeJS.Signals | null
		}>((resolvePromise, reject) => {
			child.once("error", reject)
			child.once("close", (status, signal) => resolvePromise({ status, signal }))
		})
	} finally {
		clearTimeout(timeout)
		if (forceKillTimeout) clearTimeout(forceKillTimeout)
		for (const entry of signalHandlers) process.removeListener(entry.signal, entry.handler)
	}
	if (interruptedSignal) {
		throw new Error(`benchmark interrupted by ${interruptedSignal}`)
	}
	if (!outcome) throw new Error("Harbor process exited without an outcome")
	return {
		status: outcome.status,
		signal: outcome.signal,
		timedOut,
		stdout: Buffer.concat(stdoutChunks).toString("utf8"),
		stderr: Buffer.concat(stderrChunks).toString("utf8"),
	}
}

async function runOne(
	config: PilotConfig,
	model: ModelConfig,
	task: string,
	jobsRoot: string,
	runNumber: number,
	localCoreUrl?: string,
): Promise<RunResult> {
	const jobName = `${String(runNumber).padStart(2, "0")}-${slug(model.id)}-${slug(task)}`
	const jobDir = join(jobsRoot, jobName)
	const harborModel = `${config.provider}:${model.id}`
	const timeoutMultiplier = Math.min(1, config.timeoutSeconds / taskAgentTimeoutSeconds(task))
	const taskPath = prepareTaskPath(task, jobsRoot)
	const args = [
		"run",
		"-p",
		taskPath,
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
	args.push(...verifierHarborArguments())
	args.push(...localCoreHarborArguments(localCoreUrl))

	console.log(`\n[${runNumber}] ${model.id} × ${task}`)
	const started = Date.now()
	const result = await runHarborProcess(args, config)
	const durationSeconds = (Date.now() - started) / 1000
	const secret = process.env.CLINE_API_KEY || ""
	const sanitizedOutput = redactSecrets(`${result.stdout || ""}\n${result.stderr || ""}`, [secret])
	mkdirSync(jobDir, { recursive: true, mode: 0o700 })
	writeFileSync(join(jobDir, "harbor-console.log"), sanitizedOutput, {
		mode: 0o600,
	})

	if (result.timedOut) {
		const removed = cleanupJobContainers(jobDir)
		if (existsSync(join(jobDir, "result.json"))) {
			try {
				return readInterruptedRun(jobDir, config.routerProfile, model, task)
			} catch (usageError) {
				fail(
					`Harbor timed out for ${model.id} × ${task}; cleaned ${removed.length} container(s), but usage recovery failed: ${usageError instanceof Error ? usageError.message : String(usageError)}`,
				)
			}
		}
		fail(`Harbor timed out for ${model.id} × ${task}; cleaned ${removed.length} container(s)`)
	}
	if (result.status !== 0) {
		const removed = cleanupJobContainers(jobDir)
		const tail = sanitizedOutput.trim().split("\n").slice(-20).join("\n")
		fail(
			`Harbor exited ${result.status} (signal=${result.signal}) for ${model.id} × ${task}; cleaned ${removed.length} container(s)\n${tail}`,
		)
	}
	return readJobResult(jobDir, config, model, task, durationSeconds)
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
	const result = readJobResult(jobDir, config, model, task, 0)
	console.log(`\n[${runNumber}] reusing completed ${model.id} × ${task}`)
	console.log(`  outcome=${result.outcome} reward=${result.reward ?? "missing"} cost=$${result.costUsd.toFixed(4)}`)
	return result
}

function writePrivateJson(path: string, value: unknown) {
	const temporary = `${path}.tmp-${process.pid}`
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
		mode: 0o600,
	})
	renameSync(temporary, path)
}

function writeReport(report: PilotReport) {
	writePrivateJson(join(report.jobsRoot, "pilot-report.json"), report)
}

function budgetLedgerPath(jobsRoot: string): string {
	return join(jobsRoot, "budget-ledger.json")
}

function loadBudgetLedger(jobsRoot: string, checkpointUsd: number): BudgetLedger {
	const path = budgetLedgerPath(jobsRoot)
	if (!existsSync(path)) return createBudgetLedger(checkpointUsd)
	const ledger = JSON.parse(readFileSync(path, "utf8")) as BudgetLedger
	if (ledger.schemaVersion !== 1 || ledger.checkpointUsd !== checkpointUsd || !Array.isArray(ledger.entries)) {
		fail("budget ledger is missing, incompatible, or belongs to a different checkpoint")
	}
	return ledger
}

function writeBudgetLedger(jobsRoot: string, ledger: BudgetLedger) {
	writePrivateJson(budgetLedgerPath(jobsRoot), ledger)
}

function printMatrix(config: PilotConfig) {
	console.log(`Router profile: ${config.routerProfile}`)
	console.log(`Provider: ${config.provider}`)
	console.log(
		`Limits: ${config.maxRunsPerModel} runs/model, $${config.globalBudgetUsd.toFixed(2)} global, ${config.timeoutSeconds}s/task`,
	)
	if (config.waveBudgetsUsd) {
		console.log(
			`Wave checkpoints: ${Object.entries(config.waveBudgetsUsd)
				.map(([wave, budget]) => `${wave}=$${budget.toFixed(2)}`)
				.join(", ")}`,
		)
	}
	for (const model of config.models) {
		console.log(
			`  ${model.id} [wave ${model.wave ?? 1}]: $${model.perTaskBudgetUsd.toFixed(2)}/task exposure, $${model.perModelBudgetUsd.toFixed(2)}/model stop`,
		)
	}
	console.log("Latin-square run order:")
	for (const [index, run] of buildRunMatrix(config).entries()) {
		console.log(`  ${index + 1}. [wave ${run.wave}] ${run.model.id} × ${run.task}`)
	}
}

function loadRouteTraceFile(path?: string): RouteTrace[] {
	if (!path) return []
	if (!existsSync(path)) fail(`route trace file does not exist: ${path}`)
	const canonicalPath = realpathSync(path)
	const canonicalRepo = realpathSync(repoRoot)
	if (canonicalPath === canonicalRepo || canonicalPath.startsWith(`${canonicalRepo}/`)) {
		fail("route trace file must live outside the repository")
	}
	return parseRouteTraces(readFileSync(canonicalPath, "utf8"))
}

function runKey(index: number, run: ReturnType<typeof buildRunMatrix>[number]): string {
	return `${index + 1}:${run.wave}:${run.model.id}:${run.task}`
}

function modelForResult(config: PilotConfig, result: RunResult): ModelConfig {
	const requestedModel = result.requestedModel || result.model
	return (
		config.models.find((model) => model.id === requestedModel) ??
		fail(`report references unknown requested model: ${requestedModel}`)
	)
}

async function main() {
	const args = parseArgs(process.argv.slice(2))
	const config = readConfig(args.configPath)
	validatePrerequisites(args.execute)
	printMatrix(config)
	if (!args.execute && !args.ingestRouteTraces) {
		console.log("\nDry run complete. No model was called. Pass --execute to spend.")
		return
	}

	const jobsRoot = createPrivateJobsRoot(args.jobsRoot)
	const lock = acquireRunLock(jobsRoot)
	let report: PilotReport | undefined
	try {
		const removedAtStartup = cleanupJobsRootContainers(jobsRoot)
		if (removedAtStartup.length > 0) {
			console.log(`Removed ${removedAtStartup.length} orphaned benchmark container(s) before resume.`)
		}
		const identity = executionIdentity(config, jobsRoot, args.localCoreUrl)
		const fingerprint = identity.fingerprint
		const existingReportPath = join(jobsRoot, "pilot-report.json")
		if (existsSync(existingReportPath)) {
			const existing = JSON.parse(readFileSync(existingReportPath, "utf8")) as Partial<PilotReport>
			assertReusableFingerprint(existing, fingerprint)
		} else {
			const hasUnboundResult = buildRunMatrix(config).some((run, index) => {
				const jobName = `${String(index + 1).padStart(2, "0")}-${slug(run.model.id)}-${slug(run.task)}`
				return existsSync(join(jobsRoot, jobName, "result.json"))
			})
			if (hasUnboundResult) {
				fail("jobs-root contains result artifacts without a content-addressed pilot report; use a new jobs-root")
			}
		}
		let budgetLedger = loadBudgetLedger(jobsRoot, config.globalBudgetUsd)
		const traces = loadRouteTraceFile(args.routeTracesPath)
		if (args.ingestRouteTraces) {
			if (!existsSync(existingReportPath)) fail("route trace ingestion requires an existing pilot report")
			const existing = JSON.parse(readFileSync(existingReportPath, "utf8")) as PilotReport
			assertReusableFingerprint(existing, fingerprint)
			existing.results = existing.results.map((result) =>
				attachRouteEvidence(result, modelForResult(config, result), traces),
			)
			existing.finishedAt = new Date().toISOString()
			writeReport(existing)
			console.log(`Attached route evidence to ${existing.results.length} result(s). No model was called.`)
			return
		}
		report = {
			startedAt: new Date().toISOString(),
			mode: "execute",
			config,
			executionFingerprint: fingerprint,
			executionProvenance: identity.provenance,
			jobsRoot,
			budgetLedger,
			results: [],
		}
		writePrivateJson(join(jobsRoot, "execution-manifest.json"), {
			executionFingerprint: fingerprint,
			...identity.provenance,
		})
		writeBudgetLedger(jobsRoot, budgetLedger)
		writeReport(report)

		const matrix = buildRunMatrix(config)
		if (args.onlyRun && args.onlyRun > matrix.length) {
			fail(`--only-run ${args.onlyRun} exceeds matrix size ${matrix.length}`)
		}
		const activeReservations = budgetLedger.entries.filter((entry) => entry.status === "reserved")
		for (const entry of activeReservations) {
			const matrixIndex = matrix.findIndex((run, index) => runKey(index, run) === entry.runKey)
			if (matrixIndex < 0) fail(`budget ledger reservation is not in the execution matrix: ${entry.runKey}`)
			const run = matrix[matrixIndex]
			const jobName = `${String(matrixIndex + 1).padStart(2, "0")}-${slug(run.model.id)}-${slug(run.task)}`
			if (!existsSync(join(jobsRoot, jobName, "result.json"))) {
				fail(`unsettled prior attempt has no recoverable usage; refusing to spend again: ${entry.runKey}`)
			}
		}

		const modelSpend = new Map(config.models.map((model) => [model.id, 0]))
		let globalSpend = 0
		for (const [index, run] of matrix.entries()) {
			if (args.stopAfter && index + 1 > args.stopAfter) {
				report.stoppedReason = `operator stop-after ${args.stopAfter}`
				break
			}
			const key = runKey(index, run)
			const reusedRaw = reuseCompletedRun(config, run.model, run.task, jobsRoot, index + 1)
			const reused = reusedRaw ? attachRouteEvidence(reusedRaw, run.model, traces) : null
			if (reused) {
				report.results.push(reused)
				modelSpend.set(run.model.id, (modelSpend.get(run.model.id) || 0) + reused.costUsd)
				globalSpend += reused.costUsd
				if (!budgetLedger.entries.some((entry) => entry.runKey === key)) {
					budgetLedger = reserveBudget(budgetLedger, {
						runKey: key,
						model: run.model.id,
						wave: run.wave,
						exposureUsd: run.model.perTaskBudgetUsd,
						waveBudgetUsd: config.waveBudgetsUsd?.[String(run.wave)],
					})
				}
				budgetLedger = settleBudget(budgetLedger, key, reused.costUsd)
				writeBudgetLedger(jobsRoot, budgetLedger)
				report.budgetLedger = budgetLedger
				writeReport(report)
				const reusedWaveBudget = config.waveBudgetsUsd?.[String(run.wave)]
				if (reusedWaveBudget !== undefined && ledgerExposure(budgetLedger, run.wave) > reusedWaveBudget) {
					fail(`wave ${run.wave} exceeded its $${reusedWaveBudget.toFixed(2)} checkpoint`)
				}
				continue
			}
			if (args.wave && run.wave !== args.wave) continue
			if (args.onlyRun && index + 1 !== args.onlyRun) continue
			const currentModelSpend = modelSpend.get(run.model.id) || 0
			if (currentModelSpend >= run.model.perModelBudgetUsd) {
				fail(`${run.model.id} reached its $${run.model.perModelBudgetUsd.toFixed(2)} model budget`)
			}
			if (currentModelSpend + run.model.perTaskBudgetUsd > run.model.perModelBudgetUsd) {
				fail(`${run.model.id} lacks room for its declared per-task exposure`)
			}
			if (globalSpend >= config.globalBudgetUsd) {
				fail(`pilot reached its $${config.globalBudgetUsd.toFixed(2)} global budget`)
			}
			if (globalSpend + run.model.perTaskBudgetUsd > config.globalBudgetUsd) {
				fail("pilot lacks room for the next task's declared exposure")
			}

			budgetLedger = reserveBudget(budgetLedger, {
				runKey: key,
				model: run.model.id,
				wave: run.wave,
				exposureUsd: run.model.perTaskBudgetUsd,
				waveBudgetUsd: config.waveBudgetsUsd?.[String(run.wave)],
			})
			writeBudgetLedger(jobsRoot, budgetLedger)
			report.budgetLedger = budgetLedger
			writeReport(report)

			const rawResult = await runOne(config, run.model, run.task, jobsRoot, index + 1, args.localCoreUrl)
			const result = attachRouteEvidence(rawResult, run.model, traces)
			budgetLedger = settleBudget(budgetLedger, key, result.costUsd)
			writeBudgetLedger(jobsRoot, budgetLedger)
			const waveBudget = config.waveBudgetsUsd?.[String(run.wave)]
			if (waveBudget !== undefined && ledgerExposure(budgetLedger, run.wave) > waveBudget) {
				fail(`wave ${run.wave} exceeded its $${waveBudget.toFixed(2)} checkpoint`)
			}
			report.results.push(result)
			report.budgetLedger = budgetLedger
			modelSpend.set(run.model.id, currentModelSpend + result.costUsd)
			globalSpend += result.costUsd
			writeReport(report)
			console.log(
				`  outcome=${result.outcome} reward=${result.reward ?? "missing"} cost=$${result.costUsd.toFixed(4)} duration=${result.durationSeconds.toFixed(1)}s`,
			)

			if (result.costUsd > run.model.perTaskBudgetUsd) {
				fail(`${run.model.id} exceeded its $${run.model.perTaskBudgetUsd.toFixed(2)} per-task stop after ${run.task}`)
			}
			if ((modelSpend.get(run.model.id) || 0) > run.model.perModelBudgetUsd) {
				fail(`${run.model.id} exceeded its $${run.model.perModelBudgetUsd.toFixed(2)} model budget`)
			}
			if (globalSpend > config.globalBudgetUsd) {
				fail(`pilot exceeded its $${config.globalBudgetUsd.toFixed(2)} global budget`)
			}
		}
		if (args.onlyRun) report.stoppedReason = `operator only-run ${args.onlyRun}`
		if (args.wave) report.stoppedReason = `completed wave ${args.wave}`
	} catch (error) {
		if (report) report.stoppedReason = error instanceof Error ? error.message : String(error)
		throw error
	} finally {
		if (report) {
			report.finishedAt = new Date().toISOString()
			writeReport(report)
		}
		releaseRunLock(lock)
		console.log(`\nReport: ${join(jobsRoot, "pilot-report.json")}`)
	}
}

if (import.meta.main) {
	await main()
}
