import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"

const HASH_PATTERN = /^[0-9a-f]{64}$/
export const MAX_CHECKPOINT_USD = 50

export function sha256(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex")
}

export function hashPrivateIdentifier(namespace: string, value: string): string {
	return sha256(`${namespace}\0${value}`)
}

export function redactSecrets(value: string, secrets: readonly string[]): string {
	let redacted = value
	for (const secret of secrets) {
		if (secret) redacted = redacted.split(secret).join("[REDACTED]")
	}
	return redacted
}

export function normalizeLocalCoreUrl(raw: string): string {
	let parsed: URL
	try {
		parsed = new URL(raw)
	} catch {
		throw new Error("--local-core-url must be a valid URL")
	}
	const allowedPorts = new Set(["7777", "17777"])
	if (
		parsed.protocol !== "http:" ||
		!["localhost", "127.0.0.1", "host.docker.internal"].includes(parsed.hostname) ||
		!allowedPorts.has(parsed.port) ||
		(parsed.pathname !== "/" && parsed.pathname !== "") ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash
	) {
		throw new Error(
			"--local-core-url only accepts localhost, 127.0.0.1, or host.docker.internal on port 7777 or 17777",
		)
	}
	return `http://host.docker.internal:${parsed.port}`
}

type LockOwner = {
	schemaVersion: 1
	pid: number
	host: string
	token: string
	acquiredAt: string
}

export type RunLock = {
	path: string
	token: string
}

function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid < 1) return false
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM"
	}
}

export function acquireRunLock(jobsRoot: string): RunLock {
	const lockPath = join(jobsRoot, ".pilot-run.lock")
	const ownerPath = join(lockPath, "owner.json")
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			mkdirSync(lockPath, { mode: 0o700 })
			const owner: LockOwner = {
				schemaVersion: 1,
				pid: process.pid,
				host: hostname(),
				token: randomUUID(),
				acquiredAt: new Date().toISOString(),
			}
			writeFileSync(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, {
				mode: 0o600,
			})
			return { path: lockPath, token: owner.token }
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
			let owner: Partial<LockOwner> = {}
			try {
				owner = JSON.parse(readFileSync(ownerPath, "utf8"))
			} catch {
				// An owner file can be absent only while another process is
				// acquiring the lock. Do not delete a fresh ambiguous lock.
				throw new Error(`benchmark jobs root is locked or lock ownership is ambiguous: ${lockPath}`)
			}
			if (owner.host !== hostname() || isProcessAlive(Number(owner.pid))) {
				throw new Error(`benchmark jobs root is already active (pid=${owner.pid ?? "unknown"}): ${lockPath}`)
			}
			const stalePath = `${lockPath}.stale-${Date.now()}-${randomUUID()}`
			try {
				renameSync(lockPath, stalePath)
				rmSync(stalePath, { recursive: true, force: true })
			} catch (renameError) {
				if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") throw renameError
			}
		}
	}
	throw new Error(`could not acquire benchmark jobs-root lock: ${lockPath}`)
}

export function releaseRunLock(lock: RunLock): void {
	if (!existsSync(lock.path)) return
	const ownerPath = join(lock.path, "owner.json")
	let owner: Partial<LockOwner>
	try {
		owner = JSON.parse(readFileSync(ownerPath, "utf8"))
	} catch {
		throw new Error(`refusing to release benchmark lock with unreadable owner: ${lock.path}`)
	}
	if (owner.token !== lock.token || owner.pid !== process.pid) {
		throw new Error(`refusing to release benchmark lock owned by another process: ${lock.path}`)
	}
	rmSync(lock.path, { recursive: true })
}

export type BudgetEntry = {
	runKey: string
	model: string
	wave: number
	reservedUsd: number
	actualUsd?: number
	status: "reserved" | "settled"
	updatedAt: string
}

export type BudgetLedger = {
	schemaVersion: 1
	checkpointUsd: number
	entries: BudgetEntry[]
}

export function createBudgetLedger(checkpointUsd: number): BudgetLedger {
	if (!Number.isFinite(checkpointUsd) || checkpointUsd <= 0 || checkpointUsd > MAX_CHECKPOINT_USD) {
		throw new Error(`checkpoint budget must be greater than 0 and at most $${MAX_CHECKPOINT_USD}`)
	}
	return { schemaVersion: 1, checkpointUsd, entries: [] }
}

export function ledgerExposure(ledger: BudgetLedger, wave?: number): number {
	return ledger.entries
		.filter((entry) => wave === undefined || entry.wave === wave)
		.reduce((total, entry) => total + (entry.status === "settled" ? entry.actualUsd || 0 : entry.reservedUsd), 0)
}

export function reserveBudget(
	ledger: BudgetLedger,
	input: {
		runKey: string
		model: string
		wave: number
		exposureUsd: number
		waveBudgetUsd?: number
	},
): BudgetLedger {
	if (ledger.entries.some((entry) => entry.runKey === input.runKey)) {
		throw new Error(`budget entry already exists for ${input.runKey}`)
	}
	if (!Number.isFinite(input.exposureUsd) || input.exposureUsd <= 0) {
		throw new Error("declared run exposure must be positive")
	}
	if (ledgerExposure(ledger) + input.exposureUsd > ledger.checkpointUsd) {
		throw new Error(`campaign lacks room under its $${ledger.checkpointUsd.toFixed(2)} checkpoint`)
	}
	if (
		input.waveBudgetUsd !== undefined &&
		ledgerExposure(ledger, input.wave) + input.exposureUsd > input.waveBudgetUsd
	) {
		throw new Error(`wave ${input.wave} lacks room under its $${input.waveBudgetUsd.toFixed(2)} checkpoint`)
	}
	return {
		...ledger,
		entries: [
			...ledger.entries,
			{
				runKey: input.runKey,
				model: input.model,
				wave: input.wave,
				reservedUsd: input.exposureUsd,
				status: "reserved",
				updatedAt: new Date().toISOString(),
			},
		],
	}
}

export function settleBudget(ledger: BudgetLedger, runKey: string, actualUsd: number): BudgetLedger {
	if (!Number.isFinite(actualUsd) || actualUsd < 0) throw new Error("actual run cost cannot be negative")
	const existing = ledger.entries.find((entry) => entry.runKey === runKey)
	if (existing?.status === "settled") {
		if (Math.abs((existing.actualUsd || 0) - actualUsd) > 1e-9) {
			throw new Error(`settled cost changed for ${runKey}`)
		}
		return ledger
	}
	if (!existing) throw new Error(`no budget reservation exists for ${runKey}`)
	return {
		...ledger,
		entries: ledger.entries.map((entry) =>
			entry.runKey === runKey
				? {
						...entry,
						actualUsd,
						status: "settled",
						updatedAt: new Date().toISOString(),
					}
				: entry,
		),
	}
}

export type UsageSnapshot = {
	timestamp: string
	totalCost: number
	totalInputTokens: number | null
	totalCacheReadTokens: number | null
	totalOutputTokens: number | null
}

function requireUsageNumber(value: unknown, field: string, allowMissing: boolean): number | null {
	if (allowMissing && (value === null || value === undefined)) return null
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		!Number.isInteger(value) ||
		value < 0
	) {
		throw new Error(`interrupted cost telemetry has invalid ${field}`)
	}
	return value
}

function recordValue(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

function usageSnapshot(value: unknown): UsageSnapshot | null {
	const parsed = recordValue(value)
	if (!parsed) return null
	const event = recordValue(parsed.event)
	let usage: Record<string, unknown>
	let allowMissingTokens = false
	let allowZeroNoSpendFailure = false
	if (event?.type === "usage") {
		allowMissingTokens = true
		usage = {
			totalCost: event.totalCost,
			totalInputTokens: event.totalInputTokens,
			totalCacheReadTokens: event.totalCacheReadTokens,
			totalOutputTokens: event.totalOutputTokens,
		}
	} else if (parsed.type === "run_result") {
		allowZeroNoSpendFailure = parsed.finishReason === "error"
		const cumulative = recordValue(parsed.aggregateUsage ?? parsed.usage)
		if (!cumulative) {
			throw new Error("interrupted run_result has no cumulative usage")
		}
		usage = {
			totalCost: cumulative.totalCost,
			totalInputTokens: cumulative.inputTokens,
			totalCacheReadTokens: cumulative.cacheReadTokens,
			totalOutputTokens: cumulative.outputTokens,
		}
	} else {
		return null
	}

	const timestampMs = typeof parsed.ts === "string" ? Date.parse(parsed.ts) : Number.NaN
	if (!Number.isFinite(timestampMs)) throw new Error("interrupted cost telemetry has invalid timestamp")
	const totalCost = usage.totalCost
	if (
		typeof totalCost !== "number" ||
		!Number.isFinite(totalCost) ||
		totalCost < 0 ||
		(totalCost === 0 && !allowZeroNoSpendFailure)
	) {
		throw new Error("interrupted cost telemetry has invalid totalCost")
	}
	const snapshot = {
		timestamp: new Date(timestampMs).toISOString(),
		totalCost,
		totalInputTokens: requireUsageNumber(usage.totalInputTokens, "totalInputTokens", allowMissingTokens),
		totalCacheReadTokens: requireUsageNumber(usage.totalCacheReadTokens, "totalCacheReadTokens", allowMissingTokens),
		totalOutputTokens: requireUsageNumber(usage.totalOutputTokens, "totalOutputTokens", allowMissingTokens),
	}
	if (
		totalCost === 0 &&
		(snapshot.totalInputTokens !== 0 ||
			snapshot.totalCacheReadTokens !== 0 ||
			snapshot.totalOutputTokens !== 0)
	) {
		throw new Error("zero-cost failed run reported nonzero tokens")
	}
	return snapshot
}

function sameUsage(left: UsageSnapshot, right: UsageSnapshot): boolean {
	return (
		left.totalCost === right.totalCost &&
		left.totalInputTokens === right.totalInputTokens &&
		left.totalCacheReadTokens === right.totalCacheReadTokens &&
		left.totalOutputTokens === right.totalOutputTokens
	)
}

export function recoverLatestUsage(logDocuments: readonly string[]): UsageSnapshot {
	if (logDocuments.length !== 1) {
		throw new Error(`interrupted usage recovery requires exactly one attempt; found ${logDocuments.length}`)
	}
	const snapshots: UsageSnapshot[] = []
	for (const line of logDocuments[0].split("\n")) {
		if (!line.startsWith("{")) continue
		try {
			const parsed = JSON.parse(line)
			const snapshot = usageSnapshot(parsed)
			if (snapshot) snapshots.push(snapshot)
		} catch {
			if (line.includes('"type":"usage"') || line.includes('"type":"run_result"')) {
				throw new Error("interrupted cost telemetry contains a malformed usage record")
			}
		}
	}
	if (snapshots.length === 0) throw new Error("interrupted run has no usable cost telemetry")
	snapshots.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
	for (let index = 1; index < snapshots.length; index += 1) {
		const previous = snapshots[index - 1]
		const current = snapshots[index]
		if (
			current.totalCost < previous.totalCost ||
			(current.totalInputTokens ?? 0) < (previous.totalInputTokens ?? 0) ||
			(current.totalCacheReadTokens ?? 0) < (previous.totalCacheReadTokens ?? 0) ||
			(current.totalOutputTokens ?? 0) < (previous.totalOutputTokens ?? 0)
		) {
			throw new Error("interrupted cost telemetry is non-monotonic")
		}
	}
	const latest = snapshots.at(-1)
	if (!latest) throw new Error("interrupted run has no latest usage snapshot")
	const sameTimestamp = snapshots.filter((entry) => entry.timestamp === latest.timestamp)
	if (sameTimestamp.some((entry) => !sameUsage(entry, latest))) {
		throw new Error("interrupted usage recovery is ambiguous at the latest timestamp")
	}
	if (
		latest.totalInputTokens === null ||
		latest.totalCacheReadTokens === null ||
		latest.totalOutputTokens === null
	) {
		throw new Error("interrupted latest cumulative usage is incomplete")
	}
	return latest
}

export type RouteTrace = {
	source: "core" | "legacy"
	taskIdSha256?: string
	taskHash?: string
	sessionHash?: string
	requestedModel: string
	selectedModel: string
	traceIdHash?: string
	timestamp: string
	schemaVersion?: number
	product?: string
	action?: string
	tier?: string
	mode?: string
	reason?: string
	score?: number
	taskScore?: number
	gate?: {
		evaluated: boolean
		candidateModel: string
		incumbentModel: string
		keepIncumbent: boolean
		lightCallUsd: number
		switchBackPenaltyUsd: number
		lightUsd: number
		incumbentUsd: number
		savingsUsd: number
		savingsRatio: number
	}
	features?: {
		schemaVersion: number
		messageCount: number
		userInstructionCount: number
		assistantMessageCount: number
		toolResultCount: number
		toolFailureCount: number
		totalChars: number
		userInstructionChars: number
		hasTools: boolean
		historyTokens: number
		incumbentStateUnavailable: boolean
		incumbentCacheStatusKnown: boolean
		incumbentColdLikely: boolean
	}
}

const LEGACY_ROUTE_TRACE_KEYS = new Set([
	"taskHash",
	"sessionHash",
	"requestedModel",
	"selectedModel",
	"traceIdHash",
	"timestamp",
])
const CORE_ROUTE_TRACE_KEYS = new Set([
	"schema_version",
	"timestamp",
	"task_id_sha256",
	"product",
	"action",
	"requested_model",
	"selected_concrete_model",
	"tier",
	"mode",
	"reason",
	"score",
	"task_score",
	"gate",
	"features",
])
const CORE_GATE_KEYS = new Set([
	"evaluated",
	"candidate_model",
	"incumbent_model",
	"keep_incumbent",
	"light_call_usd",
	"switch_back_penalty_usd",
	"light_usd",
	"incumbent_usd",
	"savings_usd",
	"savings_ratio",
])
const CORE_FEATURE_KEYS = new Set([
	"schema_version",
	"message_count",
	"user_instruction_count",
	"assistant_message_count",
	"tool_result_count",
	"tool_failure_count",
	"total_chars",
	"user_instruction_chars",
	"has_tools",
	"history_tokens",
	"incumbent_state_unavailable",
	"incumbent_cache_status_known",
	"incumbent_cold_likely",
])

function assertExactObjectKeys(
	raw: unknown,
	expected: ReadonlySet<string>,
	label: string,
): asserts raw is Record<string, unknown> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${label} must be an object`)
	for (const key of Object.keys(raw)) {
		if (!expected.has(key)) throw new Error(`unknown ${label} field: ${key}`)
	}
	for (const key of expected) {
		if (!(key in raw)) throw new Error(`${label} is missing field: ${key}`)
	}
}

function finiteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value)
}

export function parseRouteTraces(text: string): RouteTrace[] {
	const trimmed = text.trim()
	if (!trimmed) return []
	const rawEntries = trimmed.startsWith("[")
		? JSON.parse(trimmed)
		: trimmed
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line))
	if (!Array.isArray(rawEntries)) throw new Error("route trace file must contain a JSON array or JSONL")
	return rawEntries.map((raw, index) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			throw new Error(`route trace ${index} must be an object`)
		}
		if ("task_id_sha256" in raw || "schema_version" in raw) {
			assertExactObjectKeys(raw, CORE_ROUTE_TRACE_KEYS, `Core route trace ${index}`)
			assertExactObjectKeys(raw.gate, CORE_GATE_KEYS, `Core route trace ${index} gate`)
			assertExactObjectKeys(raw.features, CORE_FEATURE_KEYS, `Core route trace ${index} features`)
			const gate = raw.gate
			const features = raw.features
			if (
				raw.schema_version !== 1 ||
				typeof raw.timestamp !== "string" ||
				!Number.isFinite(Date.parse(raw.timestamp)) ||
				typeof raw.task_id_sha256 !== "string" ||
				!HASH_PATTERN.test(raw.task_id_sha256) ||
				typeof raw.product !== "string" ||
				typeof raw.action !== "string" ||
				typeof raw.requested_model !== "string" ||
				typeof raw.selected_concrete_model !== "string" ||
				typeof raw.tier !== "string" ||
				typeof raw.mode !== "string" ||
				typeof raw.reason !== "string" ||
				!finiteNumber(raw.score) ||
				!finiteNumber(raw.task_score)
			) {
				throw new Error(`Core route trace ${index} has invalid scalar fields`)
			}
			if (
				typeof gate.evaluated !== "boolean" ||
				typeof gate.candidate_model !== "string" ||
				typeof gate.incumbent_model !== "string" ||
				typeof gate.keep_incumbent !== "boolean" ||
				!finiteNumber(gate.light_call_usd) ||
				!finiteNumber(gate.switch_back_penalty_usd) ||
				!finiteNumber(gate.light_usd) ||
				!finiteNumber(gate.incumbent_usd) ||
				!finiteNumber(gate.savings_usd) ||
				!finiteNumber(gate.savings_ratio)
			) {
				throw new Error(`Core route trace ${index} has invalid gate fields`)
			}
			if (
				features.schema_version !== 1 ||
				!finiteNumber(features.message_count) ||
				!finiteNumber(features.user_instruction_count) ||
				!finiteNumber(features.assistant_message_count) ||
				!finiteNumber(features.tool_result_count) ||
				!finiteNumber(features.tool_failure_count) ||
				!finiteNumber(features.total_chars) ||
				!finiteNumber(features.user_instruction_chars) ||
				typeof features.has_tools !== "boolean" ||
				!finiteNumber(features.history_tokens) ||
				typeof features.incumbent_state_unavailable !== "boolean" ||
				typeof features.incumbent_cache_status_known !== "boolean" ||
				typeof features.incumbent_cold_likely !== "boolean"
			) {
				throw new Error(`Core route trace ${index} has invalid feature fields`)
			}
			return {
				source: "core",
				taskIdSha256: raw.task_id_sha256,
				requestedModel: raw.requested_model,
				selectedModel: raw.selected_concrete_model,
				timestamp: new Date(raw.timestamp).toISOString(),
				schemaVersion: raw.schema_version,
				product: raw.product,
				action: raw.action,
				tier: raw.tier,
				mode: raw.mode,
				reason: raw.reason,
				score: raw.score,
				taskScore: raw.task_score,
				gate: {
					evaluated: gate.evaluated,
					candidateModel: gate.candidate_model,
					incumbentModel: gate.incumbent_model,
					keepIncumbent: gate.keep_incumbent,
					lightCallUsd: gate.light_call_usd,
					switchBackPenaltyUsd: gate.switch_back_penalty_usd,
					lightUsd: gate.light_usd,
					incumbentUsd: gate.incumbent_usd,
					savingsUsd: gate.savings_usd,
					savingsRatio: gate.savings_ratio,
				},
				features: {
					schemaVersion: features.schema_version,
					messageCount: features.message_count,
					userInstructionCount: features.user_instruction_count,
					assistantMessageCount: features.assistant_message_count,
					toolResultCount: features.tool_result_count,
					toolFailureCount: features.tool_failure_count,
					totalChars: features.total_chars,
					userInstructionChars: features.user_instruction_chars,
					hasTools: features.has_tools,
					historyTokens: features.history_tokens,
					incumbentStateUnavailable: features.incumbent_state_unavailable,
					incumbentCacheStatusKnown: features.incumbent_cache_status_known,
					incumbentColdLikely: features.incumbent_cold_likely,
				},
			}
		}

		for (const key of Object.keys(raw)) {
			if (!LEGACY_ROUTE_TRACE_KEYS.has(key)) throw new Error(`unknown route trace field: ${key}`)
		}
		if (typeof raw.taskHash !== "string" || !HASH_PATTERN.test(raw.taskHash)) {
			throw new Error(`route trace ${index} has invalid taskHash`)
		}
		if (raw.sessionHash !== undefined && (typeof raw.sessionHash !== "string" || !HASH_PATTERN.test(raw.sessionHash))) {
			throw new Error(`route trace ${index} has invalid sessionHash`)
		}
		if (raw.traceIdHash !== undefined && (typeof raw.traceIdHash !== "string" || !HASH_PATTERN.test(raw.traceIdHash))) {
			throw new Error(`route trace ${index} has invalid traceIdHash`)
		}
		if (
			typeof raw.requestedModel !== "string" ||
			typeof raw.selectedModel !== "string" ||
			typeof raw.timestamp !== "string" ||
			!Number.isFinite(Date.parse(raw.timestamp))
		) {
			throw new Error(`route trace ${index} has invalid model or timestamp fields`)
		}
		return {
			source: "legacy",
			taskHash: raw.taskHash,
			sessionHash: typeof raw.sessionHash === "string" ? raw.sessionHash : undefined,
			requestedModel: raw.requestedModel,
			selectedModel: raw.selectedModel,
			traceIdHash: typeof raw.traceIdHash === "string" ? raw.traceIdHash : undefined,
			timestamp: new Date(raw.timestamp).toISOString(),
		}
	})
}
