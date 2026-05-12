/**
 * React hooks for polling the MacM4 dashboard endpoints.
 *
 * Both hooks fail silently when the dashboard is unreachable (e.g.
 * the user isn't running the MacM4 stack at all) -- the caller
 * decides whether to render a placeholder or hide the UI element
 * entirely based on `error` / `data === undefined`.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { MacM4ModelEntry, MacM4ModelsResponse, MacM4SavingsSummary } from "./types"

const DEFAULT_DASHBOARD_URL = "http://127.0.0.1:4001"
const DEFAULT_POLL_INTERVAL_MS = 30_000 // 30s -- model warm state changes infrequently

export interface UseMacM4ModelsResult {
	models: MacM4ModelEntry[] | undefined
	loading: boolean
	error: Error | undefined
	refresh: () => void
}

/**
 * Polls /api/macm4-models for the rich tier catalogue. Refresh
 * happens on mount + every pollIntervalMs (default 30s) so the
 * `warm` flag stays current without spamming the dashboard.
 *
 * Returns `models === undefined` while the first request is in
 * flight; returns `error` set when the dashboard is unreachable.
 */
export function useMacM4Models(
	dashboardUrl: string = DEFAULT_DASHBOARD_URL,
	pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): UseMacM4ModelsResult {
	const [models, setModels] = useState<MacM4ModelEntry[] | undefined>(undefined)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | undefined>(undefined)
	// Use a ref for the abort controller so the effect cleanup can
	// cancel an in-flight request when the component unmounts.
	const abortRef = useRef<AbortController | undefined>(undefined)

	const fetchOnce = useCallback(async (): Promise<void> => {
		abortRef.current?.abort()
		const ctl = new AbortController()
		abortRef.current = ctl
		setLoading(true)
		try {
			const resp = await fetch(`${dashboardUrl}/api/macm4-models`, {
				method: "GET",
				signal: ctl.signal,
			})
			if (!resp.ok) {
				throw new Error(`macm4-models returned ${resp.status}`)
			}
			const body = (await resp.json()) as MacM4ModelsResponse
			if (!ctl.signal.aborted) {
				setModels(body.data)
				setError(undefined)
			}
		} catch (e: unknown) {
			if (e instanceof Error && e.name === "AbortError") {
				return
			}
			if (!ctl.signal.aborted) {
				setError(e instanceof Error ? e : new Error(String(e)))
			}
		} finally {
			if (!ctl.signal.aborted) {
				setLoading(false)
			}
		}
	}, [dashboardUrl])

	useEffect(() => {
		fetchOnce()
		const interval = setInterval(fetchOnce, pollIntervalMs)
		return () => {
			clearInterval(interval)
			abortRef.current?.abort()
		}
	}, [fetchOnce, pollIntervalMs])

	return { models, loading, error, refresh: fetchOnce }
}

export interface UseMacM4SavingsResult {
	summary: MacM4SavingsSummary | undefined
	loading: boolean
	error: Error | undefined
	refresh: () => void
}

/**
 * Polls /api/stats for the rolling savings summary. The shape we
 * accept is forgiving: missing fields fall back to 0 / sensible
 * defaults so the widget can render even on a freshly-installed
 * MacM4 stack with zero requests in the cost database.
 */
export function useMacM4Savings(
	dashboardUrl: string = DEFAULT_DASHBOARD_URL,
	pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): UseMacM4SavingsResult {
	const [summary, setSummary] = useState<MacM4SavingsSummary | undefined>(undefined)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | undefined>(undefined)
	const abortRef = useRef<AbortController | undefined>(undefined)

	const fetchOnce = useCallback(async (): Promise<void> => {
		abortRef.current?.abort()
		const ctl = new AbortController()
		abortRef.current = ctl
		setLoading(true)
		try {
			const resp = await fetch(`${dashboardUrl}/api/stats`, {
				method: "GET",
				signal: ctl.signal,
			})
			if (!resp.ok) {
				throw new Error(`stats returned ${resp.status}`)
			}
			const raw = (await resp.json()) as any
			if (ctl.signal.aborted) {
				return
			}
			const normalised: MacM4SavingsSummary = {
				actual_cost_usd: Number(raw.actual_cost_usd ?? raw.actual ?? 0),
				shadow_cost_usd: Number(raw.shadow_cost_usd ?? raw.shadow ?? 0),
				savings_usd: Number(raw.savings_usd ?? raw.savings ?? 0),
				savings_pct: Number(raw.savings_pct ?? 0),
				requests_total: Number(raw.requests_total ?? raw.total ?? 0),
				requests_local: Number(raw.requests_local ?? raw.local ?? 0),
				requests_cloud: Number(raw.requests_cloud ?? raw.cloud ?? 0),
				window_label: String(raw.window_label ?? raw.window ?? "all-time"),
			}
			setSummary(normalised)
			setError(undefined)
		} catch (e: unknown) {
			if (e instanceof Error && e.name === "AbortError") {
				return
			}
			if (!ctl.signal.aborted) {
				setError(e instanceof Error ? e : new Error(String(e)))
			}
		} finally {
			if (!ctl.signal.aborted) {
				setLoading(false)
			}
		}
	}, [dashboardUrl])

	useEffect(() => {
		fetchOnce()
		const interval = setInterval(fetchOnce, pollIntervalMs)
		return () => {
			clearInterval(interval)
			abortRef.current?.abort()
		}
	}, [fetchOnce, pollIntervalMs])

	return { summary, loading, error, refresh: fetchOnce }
}
