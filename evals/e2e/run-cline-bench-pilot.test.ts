import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import {
	acquireRunLock,
	createBudgetLedger,
	hashPrivateIdentifier,
	ledgerExposure,
	normalizeLocalCoreUrl,
	parseRouteTraces,
	recoverLatestUsage,
	redactSecrets,
	releaseRunLock,
	reserveBudget,
	settleBudget,
	sha256,
} from "./cline-bench-safety"
import {
	assertReusableFingerprint,
	assertTraceIngestionCompatibility,
	buildRunMatrix,
	type ExecutionProvenance,
	fingerprintExecution,
	hashDirectoryTree,
	liveCostStopUsd,
	localCoreHarborArguments,
	matchRouteTraces,
	modelTransportHarborArguments,
	type PilotConfig,
	type PilotReport,
	prepareTaskPath,
	readConfig,
	readLiveCostStoppedRun,
	readLiveUsage,
	readRecoveredFailedRun,
	readTrialSessionIdentity,
	reuseCompletedRun,
	verifierHarborArguments,
} from "./run-cline-bench-pilot"

const temporaryDirectories: string[] = []

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true })
	}
})

function taskTree() {
	const root = mkdtempSync(join(tmpdir(), "cline-bench-fingerprint-"))
	temporaryDirectories.push(root)
	mkdirSync(join(root, "tests"))
	writeFileSync(join(root, "task.toml"), "[agent]\ntimeout_sec = 900\n")
	writeFileSync(join(root, "instruction.md"), "Fix the production bug.\n")
	writeFileSync(join(root, "tests", "test.sh"), "#!/bin/bash\nexit 0\n", {
		mode: 0o755,
	})
	return root
}

function config(): PilotConfig {
	return {
		routerProfile: "cline-router",
		provider: "cline",
		globalBudgetUsd: 10,
		maxRunsPerModel: 1,
		timeoutSeconds: 900,
		clineVersion: "3.0.46",
		models: [{ id: "openai/gpt-5.4", perTaskBudgetUsd: 2, perModelBudgetUsd: 2 }],
		tasks: ["task-a"],
	}
}

function provenance(contentHash: string, commit = "a".repeat(40)): ExecutionProvenance {
	return {
		schemaVersion: 3,
		runnerContentSha256: "b".repeat(64),
		runnerGitCommit: "c".repeat(40),
		harborVersion: "0.20.0",
		effectiveConfig: config(),
		executionOptions: { localCoreUrl: null },
		clineBenchCommit: commit,
		tasks: [{ id: "task-a", effectiveContentSha256: contentHash }],
	}
}

describe("Cline benchmark execution fingerprints", () => {
	test("hashes effective verifier content and executable mode", () => {
		const root = taskTree()
		const original = hashDirectoryTree(root)

		writeFileSync(join(root, "tests", "test.sh"), "#!/bin/bash\nexit 1\n", {
			mode: 0o755,
		})
		expect(hashDirectoryTree(root)).not.toBe(original)

		writeFileSync(join(root, "tests", "test.sh"), "#!/bin/bash\nexit 0\n", {
			mode: 0o755,
		})
		expect(hashDirectoryTree(root)).toBe(original)

		chmodSync(join(root, "tests", "test.sh"), 0o644)
		expect(hashDirectoryTree(root)).not.toBe(original)
	})

	test("changes when the exact submodule commit changes", () => {
		const contentHash = hashDirectoryTree(taskTree())
		const first = fingerprintExecution(config(), provenance(contentHash))
		const second = fingerprintExecution(config(), provenance(contentHash, "b".repeat(40)))

		expect(second).not.toBe(first)
	})

	test("changes when any effective task tree changes", () => {
		const root = taskTree()
		const firstHash = hashDirectoryTree(root)
		const first = fingerprintExecution(config(), provenance(firstHash))

		writeFileSync(join(root, "instruction.md"), "Fix the production bug and add a regression test.\n")
		const secondHash = hashDirectoryTree(root)
		const second = fingerprintExecution(config(), provenance(secondHash))

		expect(secondHash).not.toBe(firstHash)
		expect(second).not.toBe(first)
	})

	test("changes with runner, Harbor, and complete config", () => {
		const contentHash = hashDirectoryTree(taskTree())
		const base = provenance(contentHash)
		const first = fingerprintExecution(config(), base)
		expect(
			fingerprintExecution(config(), {
				...base,
				runnerContentSha256: "d".repeat(64),
			}),
		).not.toBe(first)
		expect(fingerprintExecution(config(), { ...base, harborVersion: "0.21.0" })).not.toBe(first)
		expect(
			fingerprintExecution(config(), {
				...base,
				executionOptions: {
					localCoreUrl: "http://host.docker.internal:7777",
				},
			}),
		).not.toBe(first)
		expect(
			fingerprintExecution(
				{ ...config(), globalBudgetUsd: 9 },
				{ ...base, effectiveConfig: { ...config(), globalBudgetUsd: 9 } },
			),
		).not.toBe(first)
	})

	test("rejects legacy and mismatched reports instead of blessing stale results", () => {
		expect(() => assertReusableFingerprint({}, "current")).toThrow("predates content-addressed task fingerprints")
		expect(() => assertReusableFingerprint({ executionFingerprint: "old" }, "current")).toThrow(
			"different execution matrix",
		)
		expect(() => assertReusableFingerprint({ executionFingerprint: "current" }, "current")).not.toThrow()
	})

	test("allows parser-only upgrades for offline trace ingestion", () => {
		const cfg = config()
		const stored = provenance("a".repeat(64))
		const existing = {
			config: cfg,
			executionProvenance: stored,
			executionFingerprint: fingerprintExecution(cfg, stored),
		} as PilotReport
		const upgradedParser = {
			...stored,
			runnerContentSha256: "b".repeat(64),
			runnerGitCommit: "c".repeat(40),
		}
		expect(() => assertTraceIngestionCompatibility(existing, cfg, upgradedParser)).not.toThrow()
		expect(() =>
			assertTraceIngestionCompatibility(existing, cfg, {
				...upgradedParser,
				clineBenchCommit: "d".repeat(40),
			}),
		).toThrow("matrix, endpoint, or task corpus")
	})
})

describe("Cline benchmark configuration and matrix", () => {
	test("rejects checkpoints above fifty dollars", () => {
		const root = mkdtempSync(join(tmpdir(), "cline-bench-config-"))
		temporaryDirectories.push(root)
		const path = join(root, "config.json")
		const source = JSON.parse(readFileSync(join(import.meta.dir, "cline-bench-pilot.config.json"), "utf8"))
		source.globalBudgetUsd = 51
		writeFileSync(path, JSON.stringify(source))
		expect(() => readConfig(path)).toThrow("at most 50")
	})

	test("builds model-specific staged arms without duplicate tasks", () => {
		const staged: PilotConfig = {
			...config(),
			maxRunsPerModel: 3,
			tasks: ["a", "b", "c"],
			models: [
				{
					id: "cline/auto",
					perTaskBudgetUsd: 1,
					perModelBudgetUsd: 3,
					wave: 1,
					allowedCandidates: ["x/y"],
				},
				{
					id: "openai/gpt-5.4",
					perTaskBudgetUsd: 1,
					perModelBudgetUsd: 2,
					wave: 2,
					tasks: ["a", "c"],
				},
			],
		}
		const matrix = buildRunMatrix(staged)
		expect(matrix).toHaveLength(5)
		expect(
			matrix
				.filter((run) => run.model.id === "cline/auto")
				.map((run) => run.task)
				.sort(),
		).toEqual(["a", "b", "c"])
		expect(
			matrix
				.filter((run) => run.wave === 2)
				.map((run) => run.task)
				.sort(),
		).toEqual(["a", "c"])
	})

	test("provides uv PATH to every selected verifier without changing task content or agent environment", () => {
		const jobsRoot = mkdtempSync(join(tmpdir(), "cline-bench-overlays-"))
		temporaryDirectories.push(jobsRoot)
		const checkpoint = readConfig(join(import.meta.dir, "cline-bench-router-checkpoint.config.json"))
		for (const task of checkpoint.tasks) {
			const source = join(import.meta.dir, "..", "cline-bench", "tasks", task)
			expect(readFileSync(join(source, "tests", "test.sh"), "utf8")).toMatch(/^\s*uv\s/m)
			expect(prepareTaskPath(task, jobsRoot)).toBe(`tasks/${task}`)
		}
		expect(verifierHarborArguments()).toEqual([
			"--ve",
			"PATH=/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
		])
	})

	test("keeps the checked-in 8-task checkpoint within its staged reservations", () => {
		const checkpoint = readConfig(join(import.meta.dir, "cline-bench-router-checkpoint.config.json"))
		const matrix = buildRunMatrix(checkpoint)
		expect(matrix).toHaveLength(24)
		expect(new Set(checkpoint.tasks).size).toBe(8)
		expect(matrix.filter((run) => run.model.id === "cline/auto")).toHaveLength(8)
		expect(matrix.filter((run) => run.model.id === "openai/gpt-5.4")).toHaveLength(8)
		expect(matrix.filter((run) => run.model.id === "moonshotai/kimi-k3")).toHaveLength(4)
		expect(matrix.filter((run) => run.model.id === "z-ai/glm-5.2")).toHaveLength(4)
		for (const wave of [1, 2]) {
			const exposure = matrix
				.filter((run) => run.wave === wave)
				.reduce((total, run) => total + run.model.perTaskBudgetUsd, 0)
			expect(exposure).toBeLessThanOrEqual(checkpoint.waveBudgetsUsd?.[String(wave)] || 0)
		}
	})
})

describe("Cline benchmark lock and budget ledger", () => {
	test("holds an exclusive lock and recovers a dead local owner", () => {
		const root = mkdtempSync(join(tmpdir(), "cline-bench-lock-"))
		temporaryDirectories.push(root)
		const lock = acquireRunLock(root)
		expect(() => acquireRunLock(root)).toThrow("already active")
		releaseRunLock(lock)

		const lockDir = join(root, ".pilot-run.lock")
		mkdirSync(lockDir)
		writeFileSync(
			join(lockDir, "owner.json"),
			JSON.stringify({
				schemaVersion: 1,
				pid: 999_999_999,
				host: hostname(),
				token: "stale",
				acquiredAt: new Date(0).toISOString(),
			}),
		)
		const recovered = acquireRunLock(root)
		releaseRunLock(recovered)
	})

	test("reserves before spend and enforces campaign and wave checkpoints", () => {
		let ledger = createBudgetLedger(50)
		ledger = reserveBudget(ledger, {
			runKey: "1",
			model: "cline/auto",
			wave: 1,
			exposureUsd: 20,
			waveBudgetUsd: 35,
		})
		expect(ledgerExposure(ledger)).toBe(20)
		ledger = settleBudget(ledger, "1", 12)
		expect(ledgerExposure(ledger)).toBe(12)
		expect(() =>
			reserveBudget(ledger, {
				runKey: "2",
				model: "cline/auto",
				wave: 1,
				exposureUsd: 24,
				waveBudgetUsd: 35,
			}),
		).toThrow("wave 1 lacks room")
		expect(() =>
			reserveBudget(ledger, {
				runKey: "3",
				model: "openai/gpt-5.4",
				wave: 2,
				exposureUsd: 39,
			}),
		).toThrow("campaign lacks room")

		let noSpend = createBudgetLedger(5)
		noSpend = reserveBudget(noSpend, {
			runKey: "no-spend",
			model: "cline/auto",
			wave: 1,
			exposureUsd: 1,
		})
		noSpend = settleBudget(noSpend, "no-spend", 0)
		expect(ledgerExposure(noSpend)).toBe(0)
	})
})

describe("Cline benchmark recovery, privacy, and routing evidence", () => {
	test("recovers the latest cumulative run_result usage and rejects ambiguous or incomplete telemetry", () => {
		const usage = (ts: string, totalCost: number) =>
			JSON.stringify({
				ts,
				event: {
					type: "usage",
					totalCost,
					totalInputTokens: 10,
					totalCacheReadTokens: 5,
					totalOutputTokens: 2,
				},
			})
		const runResult = JSON.stringify({
			ts: "2026-01-01T00:00:03Z",
			type: "run_result",
			finishReason: "error",
			usage: {
				inputTokens: 20,
				cacheReadTokens: 8,
				outputTokens: 3,
				totalCost: 2.5,
			},
			aggregateUsage: {
				inputTokens: 30,
				cacheReadTokens: 12,
				outputTokens: 4,
				totalCost: 3,
			},
		})
		const latest = recoverLatestUsage([
			`${usage("2026-01-01T00:00:02Z", 2)}\n${usage("2026-01-01T00:00:01Z", 1)}\n${runResult}\n`,
		])
		expect(latest).toEqual({
			timestamp: "2026-01-01T00:00:03.000Z",
			totalCost: 3,
			totalInputTokens: 30,
			totalCacheReadTokens: 12,
			totalOutputTokens: 4,
		})
		expect(() => recoverLatestUsage(["{}", "{}"])).toThrow("exactly one attempt")
		expect(() =>
			recoverLatestUsage([
				`${usage("2026-01-01T00:00:02Z", 2)}\n${usage("2026-01-01T00:00:02Z", 3)}\n`,
			]),
		).toThrow(/non-monotonic|ambiguous/)
		expect(() =>
			recoverLatestUsage([
				JSON.stringify({
					ts: "2026-01-01T00:00:02Z",
					type: "run_result",
					aggregateUsage: { inputTokens: 10, cacheReadTokens: 5, totalCost: 1 },
				}),
			]),
		).toThrow("malformed usage record")
		expect(
			recoverLatestUsage([
				JSON.stringify({
					ts: "2026-01-01T00:00:04Z",
					type: "run_result",
					finishReason: "error",
					aggregateUsage: {
						inputTokens: 0,
						cacheReadTokens: 0,
						outputTokens: 0,
						totalCost: 0,
					},
				}),
			]),
		).toMatchObject({
			totalCost: 0,
			totalInputTokens: 0,
			totalCacheReadTokens: 0,
			totalOutputTokens: 0,
		})
		expect(
			recoverLatestUsage([
				[
					JSON.stringify({
						ts: "2026-01-01T00:00:03Z",
						type: "agent_event",
						event: {
							type: "usage",
							totalCost: 0,
							totalInputTokens: 0,
							totalOutputTokens: 0,
						},
					}),
					JSON.stringify({
						ts: "2026-01-01T00:00:04Z",
						type: "run_result",
						finishReason: "error",
						aggregateUsage: {
							inputTokens: 0,
							cacheReadTokens: 0,
							outputTokens: 0,
							totalCost: 0,
						},
					}),
				].join("\n"),
			]),
		).toMatchObject({ totalCost: 0 })
		expect(() =>
			recoverLatestUsage([
				JSON.stringify({
					ts: "2026-01-01T00:00:05Z",
					type: "run_result",
					finishReason: "error",
					aggregateUsage: {
						inputTokens: 1,
						cacheReadTokens: 0,
						outputTokens: 0,
						totalCost: 0,
					},
				}),
			]),
		).toThrow("malformed usage record")
		expect(
			recoverLatestUsage([
				[
					JSON.stringify({
						exception_message:
							'stdout: {"ts":"2026-01-01T00:00:03Z","type":"run_result" ... [truncated]',
					}),
					JSON.stringify({
						ts: "2026-01-01T00:00:06Z",
						type: "run_result",
						finishReason: "error",
						aggregateUsage: {
							inputTokens: 0,
							cacheReadTokens: 0,
							outputTokens: 0,
							totalCost: 0,
						},
					}),
				].join("\n"),
			]),
		).toMatchObject({ totalCost: 0 })
	})

	test("records an ApiRateLimitError as failed, settles its reservation, and reuses it without respending", () => {
		const jobsRoot = mkdtempSync(join(tmpdir(), "cline-bench-failed-resume-"))
		temporaryDirectories.push(jobsRoot)
		const task = "task-a"
		const model = {
			id: "cline/auto",
			perTaskBudgetUsd: 2,
			perModelBudgetUsd: 2,
			allowedCandidates: ["z-ai/glm-5.2"],
		}
		const failedConfig: PilotConfig = {
			...config(),
			models: [model],
			tasks: [task],
		}
		const jobDir = join(jobsRoot, "01-cline-auto-task-a")
		const trialName = "task-a__cline__attempt-1"
		const agentDir = join(jobDir, trialName, "agent")
		mkdirSync(agentDir, { recursive: true })
		writeFileSync(
			join(jobDir, "result.json"),
			JSON.stringify({
				started_at: "2026-01-01T00:00:00Z",
				finished_at: "2026-01-01T00:00:04Z",
				trial_results: [],
				stats: {
					n_input_tokens: 30,
					n_cache_tokens: 12,
					n_output_tokens: 4,
					cost_usd: 0.25,
				},
			}),
		)
		writeFileSync(
			join(jobDir, trialName, "result.json"),
			JSON.stringify({
				task_name: task,
				started_at: "2026-01-01T00:00:00Z",
				finished_at: "2026-01-01T00:00:04Z",
				agent_info: {
					version: failedConfig.clineVersion,
					model_info: { name: "auto", provider: "cline:cline" },
				},
				exception_info: {
					exception_type: "ApiRateLimitError",
					exception_message: "Command failed with private prompt and shell command",
				},
				verifier_result: { rewards: { reward: 1 } },
			}),
		)
		writeFileSync(
			join(agentDir, "cline.txt"),
			[
				JSON.stringify({
					ts: "2026-01-01T00:00:02Z",
					event: {
						type: "usage",
						totalCost: 0.2,
						totalInputTokens: 20,
						totalCacheReadTokens: 8,
						totalOutputTokens: 3,
					},
				}),
				JSON.stringify({
					ts: "2026-01-01T00:00:03Z",
					type: "run_result",
					finishReason: "error",
					aggregateUsage: {
						inputTokens: 30,
						cacheReadTokens: 12,
						outputTokens: 4,
						totalCost: 0.25,
					},
				}),
			].join("\n"),
		)

		const failed = readRecoveredFailedRun(jobDir, failedConfig, model, task)
		expect(failed.outcome).toBe("failed")
		expect(failed.passed).toBe(false)
		expect(failed.reward).toBeNull()
		expect(failed.failureClassification).toBe("ApiRateLimitError")
		expect(failed.costUsd).toBe(0.25)
		expect(failed.inputTokens).toBe(30)
		expect(failed.cacheTokens).toBe(12)
		expect(failed.outputTokens).toBe(4)
		expect(JSON.stringify(failed)).not.toContain("private prompt")
		expect(JSON.stringify(failed)).not.toContain("shell command")

		let ledger = reserveBudget(createBudgetLedger(10), {
			runKey: "1:1:cline/auto:task-a",
			model: model.id,
			wave: 1,
			exposureUsd: model.perTaskBudgetUsd,
		})
		ledger = settleBudget(ledger, "1:1:cline/auto:task-a", failed.costUsd)
		expect(ledgerExposure(ledger)).toBe(0.25)

		const resumed = reuseCompletedRun(failedConfig, model, task, jobsRoot, 1)
		expect(resumed).toEqual(failed)
		ledger = settleBudget(ledger, "1:1:cline/auto:task-a", resumed?.costUsd || 0)
		expect(ledgerExposure(ledger)).toBe(0.25)
	})

	test("recovers a private live-cost marker without a Harbor result and never respends it", () => {
		const jobsRoot = mkdtempSync(join(tmpdir(), "cline-bench-live-cost-"))
		temporaryDirectories.push(jobsRoot)
		const task = "task-a"
		const model = {
			id: "moonshotai/kimi-k3",
			perTaskBudgetUsd: 2.2,
			perModelBudgetUsd: 2.2,
			pricing: {
				inputPerMTok: 3,
				cachedInputPerMTok: 0.3,
				outputPerMTok: 15,
			},
		}
		const guardedConfig: PilotConfig = {
			...config(),
			models: [model],
			tasks: [task],
		}
		const jobDir = join(jobsRoot, "01-moonshotai-kimi-k3-task-a")
		mkdirSync(jobDir, { recursive: true })
		const markerPath = join(jobDir, "live-cost-stop.json")
		writeFileSync(
			markerPath,
			`${JSON.stringify({
				schemaVersion: 1,
				model: model.id,
				taskHash: hashPrivateIdentifier("cline-bench-task", task),
				startedAt: "2026-01-01T00:00:00Z",
				stoppedAt: "2026-01-01T00:01:00Z",
				stopUsd: liveCostStopUsd(model.perTaskBudgetUsd),
				reservationUsd: model.perTaskBudgetUsd,
				usage: {
					timestamp: "2026-01-01T00:00:59Z",
					totalCost: 1.7,
					totalInputTokens: 100,
					totalCacheReadTokens: 80,
					totalOutputTokens: 10,
				},
			})}\n`,
			{ mode: 0o600 },
		)

		const stopped = readLiveCostStoppedRun(jobDir, guardedConfig, model, task)
		expect(stopped.outcome).toBe("failed")
		expect(stopped.failureClassification).toBe("LiveCostGuardExceeded")
		expect(stopped.costUsd).toBe(1.7)
		expect(stopped.cacheTokens).toBe(80)
		expect(statSync(markerPath).mode & 0o777).toBe(0o600)

		const resumed = reuseCompletedRun(guardedConfig, model, task, jobsRoot, 1)
		expect(resumed).toEqual(stopped)
	})

	test("reads only complete live usage records and fails closed on ambiguous attempts", () => {
		const jobsRoot = mkdtempSync(join(tmpdir(), "cline-bench-live-usage-"))
		temporaryDirectories.push(jobsRoot)
		const firstAgentDir = join(jobsRoot, "task__attempt-1", "agent")
		mkdirSync(firstAgentDir, { recursive: true })
		const firstLog = join(firstAgentDir, "cline.txt")
		const usage = (timestamp: string, totalCost: number, includeCache = true) =>
			JSON.stringify({
				ts: timestamp,
				type: "agent_event",
				event: {
					type: "usage",
					totalCost,
					totalInputTokens: Math.round(totalCost * 100),
					...(includeCache ? { totalCacheReadTokens: Math.round(totalCost * 50) } : {}),
					totalOutputTokens: Math.round(totalCost * 10),
				},
			})

		writeFileSync(firstLog, `${usage("2026-01-01T00:00:01Z", 0.5)}\n{"ts":`)
		expect(readLiveUsage(jobsRoot)?.totalCost).toBe(0.5)

		writeFileSync(
			firstLog,
			`${usage("2026-01-01T00:00:01Z", 0.5)}\n${usage("2026-01-01T00:00:02Z", 0.75, false)}\n`,
		)
		expect(readLiveUsage(jobsRoot)?.totalCost).toBe(0.75)
		expect(readLiveUsage(jobsRoot)?.totalCacheReadTokens).toBeNull()

		writeFileSync(
			firstLog,
			`${usage("2026-01-01T00:00:02Z", 0.75)}\n${usage("2026-01-01T00:00:03Z", 0.5)}\n`,
		)
		expect(() => readLiveUsage(jobsRoot)).toThrow("non-monotonic")

		writeFileSync(
			firstLog,
			`${usage("2026-01-01T00:00:02Z", 0.75)}\n{"ts":"2026-01-01T00:00:03Z","type":"agent_event","event":{"type":"usage"\n`,
		)
		expect(() => readLiveUsage(jobsRoot)).toThrow()

		writeFileSync(firstLog, `${usage("2026-01-01T00:00:02Z", 0.75)}\n`)

		const secondAgentDir = join(jobsRoot, "task__attempt-2", "agent")
		mkdirSync(secondAgentDir, { recursive: true })
		writeFileSync(join(secondAgentDir, "cline.txt"), `${usage("2026-01-01T00:00:03Z", 0.8)}\n`)
		expect(() => readLiveUsage(jobsRoot)).toThrow("exactly one attempt")
	})

	test("redacts all exact secrets and hashes private identifiers", () => {
		expect(redactSecrets("alpha secret beta token", ["secret", "token"])).toBe("alpha [REDACTED] beta [REDACTED]")
		expect(hashPrivateIdentifier("task", "raw-id")).toMatch(/^[0-9a-f]{64}$/)
		expect(hashPrivateIdentifier("task", "raw-id")).not.toContain("raw-id")
	})

	test("strictly normalizes only the local Core endpoint", () => {
		expect(liveCostStopUsd(2.2)).toBeCloseTo(1.65)
		expect(liveCostStopUsd(1.8)).toBeCloseTo(1.25)
		expect(() => liveCostStopUsd(0)).toThrow("positive")
		expect(normalizeLocalCoreUrl("http://localhost:7777")).toBe("http://host.docker.internal:7777")
		expect(normalizeLocalCoreUrl("http://127.0.0.1:17777")).toBe("http://host.docker.internal:17777")
		expect(localCoreHarborArguments("http://localhost:7777")).toEqual([
			"--ae",
			"CLINE_API_BASE_URL=http://host.docker.internal:7777",
			"--allow-agent-host",
			"host.docker.internal",
			"--allow-environment-host",
			"host.docker.internal",
		])
		expect(modelTransportHarborArguments("cline/auto", "http://localhost:7777")).toEqual(
			localCoreHarborArguments("http://localhost:7777"),
		)
		expect(modelTransportHarborArguments("cline-pass/auto", "http://localhost:17777")).toEqual(
			localCoreHarborArguments("http://localhost:17777"),
		)
		expect(modelTransportHarborArguments("moonshotai/kimi-k3", "http://localhost:7777")).toEqual([])
		expect(modelTransportHarborArguments("z-ai/glm-5.2", "http://localhost:7777")).toEqual([])
		expect(modelTransportHarborArguments("openai/gpt-5.4", "http://localhost:7777")).toEqual([])
		expect(() => normalizeLocalCoreUrl("https://localhost:7777")).toThrow("only accepts")
		expect(() => normalizeLocalCoreUrl("http://localhost:7778")).toThrow("only accepts")
		expect(() => normalizeLocalCoreUrl("http://localhost:17778")).toThrow("only accepts")
		expect(() => normalizeLocalCoreUrl("http://example.com:7777")).toThrow("only accepts")
	})

	test("parses privacy-safe route traces and rejects unknown fields", () => {
		const taskHash = "a".repeat(64)
		const traces = parseRouteTraces(
			JSON.stringify({
				taskHash,
				requestedModel: "cline/auto",
				selectedModel: "z-ai/glm-5.2",
				timestamp: "2026-01-01T00:00:00Z",
			}),
		)
		expect(traces).toHaveLength(1)
		expect(() =>
			parseRouteTraces(
				JSON.stringify({
					taskHash,
					requestedModel: "cline/auto",
					selectedModel: "z-ai/glm-5.2",
					timestamp: "2026-01-01T00:00:00Z",
					rawTaskId: "secret",
				}),
			),
		).toThrow("unknown route trace field")
	})

	test("correlates an exact Core JSONL trace with the Cline session recorded by Harbor", () => {
		const jobRoot = mkdtempSync(join(tmpdir(), "cline-bench-route-correlation-"))
		temporaryDirectories.push(jobRoot)
		const trialName = "task__cline__trial-1"
		const agentDir = join(jobRoot, trialName, "agent")
		mkdirSync(agentDir, { recursive: true })
		const sessionId = "1784094124598_ymnl2"
		writeFileSync(join(agentDir, "trajectory.json"), JSON.stringify({ session_id: sessionId }))

		const identity = readTrialSessionIdentity(jobRoot, trialName)
		expect(identity).toEqual({
			sessionHash: hashPrivateIdentifier("cline-bench-session", sessionId),
			sessionIdSha256: sha256(sessionId),
		})

		const coreLine = {
			schema_version: 1,
			timestamp: "2026-07-24T12:34:56Z",
			task_id_sha256: sha256(sessionId),
			product: "cline-router",
			action: "route",
			requested_model: "cline/auto",
			selected_concrete_model: "z-ai/glm-5.2",
			tier: "medium",
			mode: "cost-aware",
			reason: "classifier",
			score: 0.84,
			task_score: 0.71,
			gate: {
				evaluated: true,
				candidate_model: "z-ai/glm-5.2",
				incumbent_model: "openai/gpt-5.4",
				keep_incumbent: false,
				light_call_usd: 0.02,
				switch_back_penalty_usd: 0.01,
				light_usd: 0.04,
				incumbent_usd: 0.12,
				savings_usd: 0.08,
				savings_ratio: 0.67,
			},
			features: {
				schema_version: 2,
				message_count: 4,
				user_instruction_count: 1,
				assistant_message_count: 2,
				tool_result_count: 1,
				tool_failure_count: 0,
				total_chars: 1200,
				user_instruction_chars: 300,
				has_tools: true,
				history_tokens: 420,
				incumbent_state_unavailable: false,
				incumbent_cache_status_known: true,
				incumbent_cold_likely: false,
			},
		}
		const traces = parseRouteTraces(`${JSON.stringify(coreLine)}\n`)
		expect(traces[0]?.source).toBe("core")
		expect(traces[0]?.features?.historyTokens).toBe(420)

		const matched = matchRouteTraces(traces, {
			requestedModel: "cline/auto",
			taskHash: hashPrivateIdentifier("cline-bench-task", "harbor-task-slug"),
			sessionHash: identity?.sessionHash ?? null,
			sessionIdSha256: identity?.sessionIdSha256 ?? null,
		})
		expect(matched).toHaveLength(1)
		expect(
			matchRouteTraces(traces, {
				requestedModel: "cline/auto",
				taskHash: hashPrivateIdentifier("cline-bench-task", "harbor-task-slug"),
				sessionHash: identity?.sessionHash ?? null,
				sessionIdSha256: sha256("different-session"),
			}),
		).toHaveLength(0)
		expect(JSON.stringify({ identity, traces })).not.toContain(sessionId)
	})
})
