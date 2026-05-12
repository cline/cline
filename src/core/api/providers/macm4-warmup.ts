/**
 * MacM4LocalAgent warm-up pre-flight check.
 *
 * Used by the macm4 provider (and any other Cline integration point
 * that wants to surface "model loading" state) to confirm the local
 * backend has the target model resident in memory.
 *
 * What it does, in order:
 *
 *   1. Polls the MacM4 dashboard's /api/macm4-models endpoint (added
 *      in M7). The `warm` flag there reflects Ollama's /api/ps
 *      output and is the cheapest authoritative signal -- one HTTP
 *      call to the same loopback host, no auth, no streaming.
 *
 *   2. If the tier reports warm=true, return immediately.
 *
 *   3. If warm=false (or the dashboard is unreachable), trigger a
 *      keep-alive request directly against the appropriate backend:
 *         - local-long  -> POST :11434/api/generate (empty prompt,
 *                          keep_alive: -1; loads + locks the model)
 *         - local-fast  -> the MLX server's KeepAlive plist keeps
 *                          this one resident already; we just verify
 *                          /health responds.
 *
 *   4. Return a structured result so the caller can decide whether
 *      to surface a "warming up..." UI message or proceed immediately.
 *
 * Why this matters: a cold local-long load can take 30-60s on the
 * first turn after a system reboot or KeepAlive expiry. Without this
 * check, Cline sends the user's first prompt straight into a request
 * that appears to hang for a minute. The warm-up pre-flight either
 * confirms the model is ready (~50ms) or kicks the load explicitly
 * and tells the UI to show progress.
 *
 * The check is intentionally read-only when the model is already
 * warm; the keep_alive: -1 trigger path runs at most once per
 * cold-start, then the M4-side launchd agent keeps things resident.
 */

import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"

export interface MacM4WarmupOptions {
	/** Canonical tier id (local-fast, local-long, etc.). */
	tierId: string
	/** Dashboard base URL. Defaults to http://127.0.0.1:4001. */
	dashboardUrl?: string
	/** Ollama base URL. Defaults to http://127.0.0.1:11434. */
	ollamaUrl?: string
	/** MLX server base URL. Defaults to http://127.0.0.1:8081. */
	mlxUrl?: string
	/** Override the model tag posted to Ollama. Defaults to the tierId. */
	ollamaModelTag?: string
	/** Probe timeout for the metadata endpoint (ms). Default 500. */
	probeTimeoutMs?: number
	/** Warm-load timeout when we have to trigger a model load (ms). Default 90_000. */
	loadTimeoutMs?: number
}

export type MacM4WarmupOutcome =
	| { status: "warm"; tierId: string; source: "dashboard" | "mlx-health" | "ollama-ps" }
	| { status: "loaded"; tierId: string; durationMs: number }
	| { status: "skipped"; tierId: string; reason: string }
	| { status: "failed"; tierId: string; reason: string }

const DEFAULT_DASHBOARD = "http://127.0.0.1:4001"
const DEFAULT_OLLAMA = "http://127.0.0.1:11434"
const DEFAULT_MLX = "http://127.0.0.1:8081"
const DEFAULT_PROBE_TIMEOUT_MS = 500
const DEFAULT_LOAD_TIMEOUT_MS = 90_000

/**
 * Tiers that the warm-up flow applies to. Cloud tiers and the
 * hybrid-auto router pseudo-model never need warm-up.
 */
const WARMABLE_LOCAL_TIERS = new Set(["local-fast", "local-long", "local-agent"])

function isCloudTier(tierId: string): boolean {
	return (
		tierId.startsWith("claude") ||
		tierId === "hybrid-auto" ||
		tierId.startsWith("gpt-claude") ||
		tierId.startsWith("gpt-hybrid")
	)
}

function stripGptPrefix(id: string): string {
	return id.startsWith("gpt-") ? id.slice(4) : id
}

async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
	const ctl = new AbortController()
	const t = setTimeout(() => ctl.abort(), init.timeoutMs)
	try {
		return await fetch(url, { ...init, signal: ctl.signal })
	} finally {
		clearTimeout(t)
	}
}

/**
 * Ask the M7 dashboard endpoint whether the tier is warm. Returns
 * true if warm, false if known-cold, undefined if the dashboard is
 * unreachable or returns an unexpected shape.
 */
async function probeDashboard(
	tierId: string,
	dashboardUrl: string,
	timeoutMs: number,
): Promise<boolean | undefined> {
	try {
		const resp = await fetchWithTimeout(`${dashboardUrl}/api/macm4-models`, {
			method: "GET",
			timeoutMs,
		})
		if (!resp.ok) {
			return undefined
		}
		const body = (await resp.json()) as { data?: Array<{ id: string; warm?: boolean }> }
		const entry = body.data?.find((m) => m.id === tierId)
		if (entry === undefined) {
			return undefined
		}
		return entry.warm === true
	} catch {
		return undefined
	}
}

/**
 * Direct Ollama probe: GET /api/ps and check whether the expected
 * tag is in the loaded set. Cheaper than the dashboard call (no
 * dashboard hop) but skips the M7 metadata contract -- so we only
 * use it when the dashboard is unreachable.
 */
async function probeOllamaPs(
	expectedTag: string,
	ollamaUrl: string,
	timeoutMs: number,
): Promise<boolean | undefined> {
	try {
		const resp = await fetchWithTimeout(`${ollamaUrl}/api/ps`, {
			method: "GET",
			timeoutMs,
		})
		if (!resp.ok) {
			return undefined
		}
		const body = (await resp.json()) as { models?: Array<{ name?: string }> }
		return body.models?.some((m) => m.name === expectedTag) === true
	} catch {
		return undefined
	}
}

/**
 * Trigger an Ollama model load with keep_alive: -1. Empty prompt
 * yields ~0 output tokens so this is the cheapest possible load.
 */
async function triggerOllamaLoad(
	modelTag: string,
	ollamaUrl: string,
	timeoutMs: number,
): Promise<void> {
	await fetchWithTimeout(`${ollamaUrl}/api/generate`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: modelTag,
			prompt: "",
			keep_alive: -1,
			options: { num_predict: 1 },
		}),
		timeoutMs,
	})
}

/**
 * Probe the MLX server's health endpoint. We don't try to "warm"
 * MLX -- its launchd plist keeps the process alive, and there's no
 * unload-on-idle behaviour to fight against.
 */
async function probeMlxHealth(mlxUrl: string, timeoutMs: number): Promise<boolean> {
	try {
		const resp = await fetchWithTimeout(`${mlxUrl}/health`, {
			method: "GET",
			timeoutMs,
		})
		return resp.ok
	} catch {
		// /health may not exist on older MLX builds; fall back to
		// /v1/models which any OpenAI-compat server must answer.
		try {
			const resp = await fetchWithTimeout(`${mlxUrl}/v1/models`, {
				method: "GET",
				timeoutMs,
			})
			return resp.ok
		} catch {
			return false
		}
	}
}

/**
 * Run a warm-up pre-flight check for the given tier.
 *
 * Returns a structured outcome describing what happened. The caller
 * should display "warming up..." to the user only when the outcome
 * is `loaded` (we had to trigger a cold start) -- the `warm` outcome
 * means the prompt can be sent immediately, and `skipped`/`failed`
 * mean we either can't or shouldn't warm.
 */
export async function warmupMacM4Tier(options: MacM4WarmupOptions): Promise<MacM4WarmupOutcome> {
	const tierId = stripGptPrefix(options.tierId)

	if (isCloudTier(tierId)) {
		return { status: "skipped", tierId, reason: "cloud tier; no warm-up needed" }
	}

	const dashboardUrl = options.dashboardUrl || DEFAULT_DASHBOARD
	const ollamaUrl = options.ollamaUrl || DEFAULT_OLLAMA
	const mlxUrl = options.mlxUrl || DEFAULT_MLX
	const probeTimeout = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
	const loadTimeout = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS

	// MLX path is just a health check; never needs explicit warm.
	if (tierId === "local-fast") {
		const ok = await probeMlxHealth(mlxUrl, probeTimeout)
		if (ok) {
			return { status: "warm", tierId, source: "mlx-health" }
		}
		return {
			status: "failed",
			tierId,
			reason: `MLX server at ${mlxUrl} unreachable (cold start?)`,
		}
	}

	if (!WARMABLE_LOCAL_TIERS.has(tierId)) {
		return { status: "skipped", tierId, reason: "unknown tier id" }
	}

	// Ollama-backed tier: try the dashboard first, then fall back to
	// querying /api/ps directly.
	const dashboardWarm = await probeDashboard(tierId, dashboardUrl, probeTimeout)
	if (dashboardWarm === true) {
		return { status: "warm", tierId, source: "dashboard" }
	}

	const expectedTag = options.ollamaModelTag || tierId
	const psWarm = await probeOllamaPs(expectedTag, ollamaUrl, probeTimeout)
	if (psWarm === true) {
		return { status: "warm", tierId, source: "ollama-ps" }
	}

	// Cold: trigger the load.
	const start = Date.now()
	try {
		await triggerOllamaLoad(expectedTag, ollamaUrl, loadTimeout)
	} catch (err) {
		Logger.warn(`[MacM4 warmup] ${tierId} load failed:`, err)
		return {
			status: "failed",
			tierId,
			reason: err instanceof Error ? err.message : String(err),
		}
	}
	return { status: "loaded", tierId, durationMs: Date.now() - start }
}
