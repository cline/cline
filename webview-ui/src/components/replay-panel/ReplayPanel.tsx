import React, { useCallback, useEffect, useRef, useState } from "react"
import { PLATFORM_CONFIG } from "../../config/platform.config"

interface QualityFlag {
	validator: string
	status: string
}

interface RunEntry {
	run_id: string
	tool_name: string
	session_id: string
	timestamp: string
	key_outputs: Record<string, unknown>
	diff_status?: "match" | "mismatch" | "missing"
	diff_notes?: string[]
}

interface ReplayData {
	session_id: string
	source: "session" | "capsule"
	entries: RunEntry[]
	session_path?: string
	capsule_path?: string
}

type ReviewFilter = "all" | "review" | "failed"

interface RunReviewState {
	checks: number
	warnings: number
	failures: number
	needsReview: boolean
}

const BUTTON_BASE =
	"text-[10px] rounded border border-[var(--vscode-panel-border)] px-2 py-0.5 bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed"

function postMessage(msg: unknown) {
	PLATFORM_CONFIG.postMessage(msg)
}

function fmtTimestamp(ts: string): string {
	try {
		return `${ts.replace("T", " ").slice(0, 19)} UTC`
	} catch {
		return ts
	}
}

function flagsFromOutputs(keyOutputs: Record<string, unknown>): QualityFlag[] {
	const raw = keyOutputs._quality_flags
	if (!Array.isArray(raw)) {
		return []
	}
	return raw as QualityFlag[]
}

function reviewState(entry: RunEntry): RunReviewState {
	const flags = flagsFromOutputs(entry.key_outputs)
	const warnings = flags.filter((f) => f.status === "warn" || f.status === "advisory").length
	const failures = flags.filter((f) => f.status === "fail" || f.status === "error").length
	const diffNeedsReview = entry.diff_status === "mismatch" || entry.diff_status === "missing"
	return {
		checks: flags.length,
		warnings,
		failures,
		needsReview: warnings > 0 || failures > 0 || diffNeedsReview,
	}
}

function statusColor(status: string): string {
	switch (status) {
		case "pass":
		case "match":
			return "var(--vscode-testing-iconPassed)"
		case "warn":
		case "advisory":
		case "missing":
			return "var(--vscode-testing-iconQueued)"
		case "fail":
		case "error":
		case "mismatch":
			return "var(--vscode-testing-iconFailed)"
		default:
			return "var(--vscode-disabledForeground)"
	}
}

function runStatus(entry: RunEntry): { icon: string; label: string; color: string } {
	const state = reviewState(entry)
	if (state.failures > 0 || entry.diff_status === "mismatch") {
		return { icon: "codicon-error", label: "failed", color: "var(--vscode-testing-iconFailed)" }
	}
	if (state.needsReview) {
		return { icon: "codicon-warning", label: "needs review", color: "var(--vscode-testing-iconQueued)" }
	}
	return { icon: "codicon-pass-filled", label: "ok", color: "var(--vscode-testing-iconPassed)" }
}

function runShortId(runId: string): string {
	return runId.replace(/^run\./, "")
}

function sourceLabel(data: ReplayData): string {
	return data.session_path ?? data.capsule_path ?? data.session_id
}

function provenanceSnippet(entry: RunEntry, data: ReplayData): string {
	return [
		`run_id: ${entry.run_id}`,
		`tool: ${entry.tool_name}`,
		`session: ${data.session_id}`,
		`source: ${sourceLabel(data)}`,
		`timestamp: ${fmtTimestamp(entry.timestamp)}`,
		`outputs: ${JSON.stringify(entry.key_outputs)}`,
	].join("\n")
}

async function copyText(text: string): Promise<void> {
	try {
		await navigator.clipboard?.writeText(text)
	} catch {
		// VS Code webviews may deny clipboard without user gesture in some contexts.
		console.warn("[ReplayPanel] Clipboard write was unavailable")
	}
}

const RunListRow: React.FC<{
	entry: RunEntry
	index: number
	selected: boolean
	onClick: () => void
}> = ({ entry, index, selected, onClick }) => {
	const state = reviewState(entry)
	const status = runStatus(entry)
	return (
		<button
			className={[
				"w-full text-left border-b border-[var(--vscode-panel-border)] px-3 py-2 bg-transparent text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]",
				selected
					? "bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)] shadow-[inset_3px_0_0_var(--vscode-focusBorder)]"
					: "",
			].join(" ")}
			onClick={onClick}
			type="button">
			<div className="flex items-center gap-2">
				<span className="text-[9px] font-mono opacity-45 w-5 text-right shrink-0">{index + 1}</span>
				<span className={`codicon ${status.icon} text-[13px] shrink-0`} style={{ color: status.color }} />
				<span className="font-mono text-[11px] font-semibold truncate flex-1">{entry.tool_name}</span>
				<span className="text-[9px] uppercase tracking-wide" style={{ color: status.color }}>
					{status.label}
				</span>
			</div>
			<div className="mt-1 flex items-center gap-2 text-[9px] opacity-60">
				<span className="font-mono truncate">{runShortId(entry.run_id)}</span>
				<span className="ml-auto">
					{state.warnings > 0 && (
						<span style={{ color: "var(--vscode-testing-iconQueued)" }}>{state.warnings} warn</span>
					)}
					{state.failures > 0 && (
						<span className="ml-1" style={{ color: "var(--vscode-testing-iconFailed)" }}>
							{state.failures} fail
						</span>
					)}
					{state.warnings === 0 && state.failures === 0 && `${state.checks} check${state.checks !== 1 ? "s" : ""}`}
				</span>
			</div>
		</button>
	)
}

const RunDetail: React.FC<{ entry: RunEntry | null; data: ReplayData }> = ({ entry, data }) => {
	if (!entry) {
		return (
			<div className="flex flex-col items-center justify-center h-full text-center opacity-55 px-4">
				<span className="codicon codicon-debug-rerun text-[28px] mb-2" />
				<p className="text-sm">Select a run to inspect outputs, quality checks, and provenance.</p>
			</div>
		)
	}

	const flags = flagsFromOutputs(entry.key_outputs)
	const outputs = Object.entries(entry.key_outputs).filter(([k]) => k !== "_quality_flags")
	const state = reviewState(entry)
	const status = runStatus(entry)
	return (
		<div className="h-full overflow-auto px-4 py-3 text-[11px]">
			<div className="flex items-start gap-2 mb-3">
				<span className={`codicon ${status.icon} text-[16px] mt-0.5`} style={{ color: status.color }} />
				<div className="min-w-0">
					<div className="font-mono text-sm font-semibold truncate">{entry.tool_name}</div>
					<div className="font-mono text-[10px] opacity-60 truncate" title={entry.run_id}>
						{entry.run_id}
					</div>
				</div>
				<button
					className={`${BUTTON_BASE} ml-auto`}
					onClick={() => void copyText(provenanceSnippet(entry, data))}
					type="button">
					Copy provenance
				</button>
			</div>

			<div className="grid grid-cols-3 gap-2 mb-3">
				<div className="rounded border border-[var(--vscode-panel-border)] px-2 py-1">
					<div className="opacity-60 text-[9px]">checks</div>
					<div className="font-mono">{state.checks}</div>
				</div>
				<div className="rounded border border-[var(--vscode-panel-border)] px-2 py-1">
					<div className="opacity-60 text-[9px]">warnings</div>
					<div className="font-mono" style={{ color: "var(--vscode-testing-iconQueued)" }}>
						{state.warnings}
					</div>
				</div>
				<div className="rounded border border-[var(--vscode-panel-border)] px-2 py-1">
					<div className="opacity-60 text-[9px]">failures</div>
					<div className="font-mono" style={{ color: "var(--vscode-testing-iconFailed)" }}>
						{state.failures}
					</div>
				</div>
			</div>

			{outputs.length > 0 && (
				<section className="mb-3">
					<div className="text-[9px] font-semibold uppercase tracking-wide opacity-60 mb-1">Key outputs</div>
					<div className="rounded border border-[var(--vscode-panel-border)] overflow-hidden">
						{outputs.map(([k, v]) => (
							<div
								className="grid grid-cols-[160px_1fr] border-b border-[var(--vscode-panel-border)] last:border-b-0"
								key={k}>
								<div className="px-2 py-1 font-mono opacity-65 bg-[var(--vscode-list-inactiveSelectionBackground)]">
									{k}
								</div>
								<div className="px-2 py-1 font-mono break-all">
									{typeof v === "object" ? JSON.stringify(v, null, 2) : String(v ?? "—")}
								</div>
							</div>
						))}
					</div>
				</section>
			)}

			{flags.length > 0 && (
				<section className="mb-3">
					<div className="text-[9px] font-semibold uppercase tracking-wide opacity-60 mb-1">Quality checks</div>
					<div className="flex flex-wrap gap-1.5">
						{flags.map((f) => (
							<span
								className="inline-flex items-center gap-1 rounded border border-[var(--vscode-panel-border)] px-1.5 py-0.5 font-mono"
								key={`${f.validator}:${f.status}`}>
								<span
									className="codicon codicon-circle-filled text-[7px]"
									style={{ color: statusColor(f.status) }}
								/>
								{f.validator}
								<span style={{ color: statusColor(f.status) }}>{f.status}</span>
							</span>
						))}
					</div>
				</section>
			)}

			{entry.diff_notes && entry.diff_notes.length > 0 && (
				<section className="mb-3">
					<div className="text-[9px] font-semibold uppercase tracking-wide opacity-60 mb-1">Review notes</div>
					<div className="rounded border border-[var(--vscode-panel-border)] px-2 py-1.5">
						{entry.diff_notes.map((note) => (
							<p className="font-mono text-[10px] opacity-80" key={note}>
								• {note}
							</p>
						))}
					</div>
				</section>
			)}

			<section>
				<div className="text-[9px] font-semibold uppercase tracking-wide opacity-60 mb-1">Source</div>
				<div className="font-mono text-[10px] opacity-75 break-all">{sourceLabel(data)}</div>
				<div className="font-mono text-[10px] opacity-55">{fmtTimestamp(entry.timestamp)}</div>
			</section>
		</div>
	)
}

export const ReplayPanel: React.FC = () => {
	const [sessionId, setSessionId] = useState("")
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [data, setData] = useState<ReplayData | null>(null)
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
	const [filterTool, setFilterTool] = useState("")
	const [statusFilter, setStatusFilter] = useState<ReviewFilter>("all")
	const [recentSessions, setRecentSessions] = useState<string[]>([])
	const [focusRunId, setFocusRunId] = useState<string | null>(null)
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const msg = event.data
			if (!msg?.type) {
				return
			}
			if (msg.type === "replay_data") {
				const entries = msg.entries ?? []
				setData({
					session_id: msg.session_id,
					source: msg.source ?? "session",
					entries,
					session_path: msg.session_path,
					capsule_path: msg.capsule_path,
				})
				setLoading(false)
				setError(null)
				const targetRun = String(msg.focus_run_id ?? focusRunId ?? "")
				setSelectedRunId(
					targetRun && entries.some((entry: RunEntry) => entry.run_id === targetRun)
						? targetRun
						: (entries[0]?.run_id ?? null),
				)
			} else if (msg.type === "replay_error") {
				setError(msg.message ?? "Unknown error")
				setLoading(false)
			} else if (msg.type === "session_list") {
				setRecentSessions(Array.isArray(msg.sessions) ? msg.sessions.map(String) : [])
			} else if (msg.type === "load_replay") {
				const sid = String(msg.session_id ?? "")
				const target = String(msg.focus_run_id ?? "")
				setSessionId(sid)
				setFocusRunId(target || null)
				if (sid.trim()) {
					setLoading(true)
					setError(null)
					setData(null)
					postMessage({ type: "load_replay", session_id: sid.trim(), focus_run_id: target || undefined })
				}
			}
		}
		window.addEventListener("message", handler)
		postMessage({ type: "replay_ready" })
		postMessage({ type: "list_sessions" })
		return () => window.removeEventListener("message", handler)
	}, [])

	const load = useCallback(() => {
		if (!sessionId.trim()) {
			setError("Enter a session_id or session JSON/capsule path.")
			return
		}
		setLoading(true)
		setError(null)
		setData(null)
		setFocusRunId(null)
		setSelectedRunId(null)
		postMessage({ type: "load_replay", session_id: sessionId.trim() })
	}, [sessionId])

	const loadDemo = useCallback(() => {
		setSessionId("demo-reproducibility-cockpit")
		setLoading(true)
		setError(null)
		setData(null)
		setFocusRunId(null)
		setSelectedRunId(null)
		postMessage({ type: "load_replay", session_id: "demo-reproducibility-cockpit" })
	}, [])

	const filteredEntries = React.useMemo(() => {
		if (!data?.entries) {
			return []
		}
		const q = filterTool.toLowerCase().trim()
		return data.entries.filter((entry) => {
			const state = reviewState(entry)
			if (statusFilter === "failed" && state.failures === 0 && entry.diff_status !== "mismatch") {
				return false
			}
			if (statusFilter === "review" && !state.needsReview) {
				return false
			}
			if (!q) {
				return true
			}
			return (
				entry.tool_name.toLowerCase().includes(q) ||
				entry.run_id.toLowerCase().includes(q) ||
				String(entry.key_outputs.basin_id ?? "")
					.toLowerCase()
					.includes(q)
			)
		})
	}, [data, filterTool, statusFilter])

	useEffect(() => {
		if (selectedRunId && filteredEntries.some((entry) => entry.run_id === selectedRunId)) {
			return
		}
		setSelectedRunId(filteredEntries[0]?.run_id ?? null)
	}, [filteredEntries, selectedRunId])

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (!filteredEntries.length) {
				return
			}
			const current = Math.max(
				0,
				filteredEntries.findIndex((entry) => entry.run_id === selectedRunId),
			)
			if (e.key === "ArrowDown") {
				e.preventDefault()
				setSelectedRunId(filteredEntries[Math.min(current + 1, filteredEntries.length - 1)]?.run_id ?? null)
			} else if (e.key === "ArrowUp") {
				e.preventDefault()
				setSelectedRunId(filteredEntries[Math.max(current - 1, 0)]?.run_id ?? null)
			} else if (e.key === "Escape") {
				setSelectedRunId(null)
			}
		}
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [filteredEntries, selectedRunId])

	const summary = React.useMemo(() => {
		if (!data?.entries.length) {
			return null
		}
		const total = data.entries.length
		const needsReview = data.entries.filter((entry) => reviewState(entry).needsReview).length
		const failed = data.entries.filter((entry) => reviewState(entry).failures > 0 || entry.diff_status === "mismatch").length
		const tools = Array.from(new Set(data.entries.map((entry) => entry.tool_name))).sort()
		return { total, needsReview, failed, tools }
	}, [data])

	const selectedEntry = data?.entries.find((entry) => entry.run_id === selectedRunId) ?? null

	return (
		<div
			className="flex flex-col h-full w-full bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)]"
			ref={containerRef}
			style={{ fontFamily: "var(--vscode-font-family)" }}>
			<div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--vscode-panel-border)] shrink-0">
				<span className="codicon codicon-history text-[14px] opacity-70" />
				<span className="text-sm font-semibold">Session Replay</span>
				{data && <span className="text-[10px] opacity-55 font-mono ml-1 truncate max-w-[240px]">{data.session_id}</span>}
				<div className="ml-auto flex items-center gap-2">
					<input
						className="text-[10px] rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] px-1.5 py-0.5 w-64"
						list="aihydro-replay-recent-sessions"
						onChange={(e) => setSessionId(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && load()}
						placeholder="session_id or capsule path"
						type="text"
						value={sessionId}
					/>
					<datalist id="aihydro-replay-recent-sessions">
						{recentSessions.map((sid) => (
							<option key={sid} value={sid} />
						))}
					</datalist>
					<button className={BUTTON_BASE} onClick={loadDemo} type="button">
						Demo
					</button>
					<button
						className="text-[10px] rounded border border-[var(--vscode-button-border,var(--vscode-panel-border))] bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] px-2 py-0.5 cursor-pointer hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50"
						disabled={loading}
						onClick={load}
						type="button">
						{loading ? "Loading…" : "Load"}
					</button>
				</div>
			</div>

			{error && (
				<div className="mx-3 mt-2 px-2 py-1.5 rounded border border-[var(--vscode-testing-iconFailed)] text-[11px] text-[var(--vscode-testing-iconFailed)]">
					<span className="codicon codicon-error text-[10px] mr-1" />
					{error}
				</div>
			)}

			{!data && !loading && !error && (
				<div className="flex flex-col items-center justify-center flex-1 opacity-65 text-center px-4">
					<span className="codicon codicon-history text-[32px] mb-2" />
					<p className="text-sm">Enter a session id/path or click Demo to inspect provenance runs.</p>
					{recentSessions.length > 0 && (
						<p className="text-[10px] mt-1 opacity-75">Recent sessions: {recentSessions.slice(0, 5).join(", ")}</p>
					)}
				</div>
			)}

			{loading && (
				<div className="flex items-center justify-center flex-1 opacity-50">
					<span className="codicon codicon-loading codicon-modifier-spin text-[20px] mr-2" />
					<span className="text-sm">Loading run log…</span>
				</div>
			)}

			{data && !loading && (
				<div className="flex flex-col flex-1 overflow-hidden">
					{summary && (
						<div className="flex items-center gap-4 px-3 py-1.5 border-b border-[var(--vscode-panel-border)] shrink-0 text-[10px] opacity-75">
							<span>
								<span className="codicon codicon-run-all text-[10px] mr-1" />
								{summary.total} runs
							</span>
							<span
								style={{
									color:
										summary.needsReview > 0
											? "var(--vscode-testing-iconQueued)"
											: "var(--vscode-testing-iconPassed)",
								}}>
								<span className="codicon codicon-warning text-[10px] mr-1" />
								{summary.needsReview} need review
							</span>
							<span
								style={{
									color:
										summary.failed > 0
											? "var(--vscode-testing-iconFailed)"
											: "var(--vscode-testing-iconPassed)",
								}}>
								{summary.failed} failed
							</span>
							<span className="truncate max-w-[360px]" title={sourceLabel(data)}>
								<span className="opacity-70">source:</span> {data.session_id}
							</span>
							<span className="ml-auto font-mono">
								{summary.tools.length} tools: {summary.tools.slice(0, 4).join(", ")}
							</span>
						</div>
					)}

					<div className="px-3 py-1 border-b border-[var(--vscode-panel-border)] shrink-0 flex items-center gap-2">
						{(["all", "review", "failed"] as const).map((mode) => (
							<button
								className={`${BUTTON_BASE} ${statusFilter === mode ? "border-[var(--vscode-focusBorder)] shadow-[0_0_0_1px_var(--vscode-focusBorder)]" : ""}`}
								key={mode}
								onClick={() => setStatusFilter(mode)}
								type="button">
								{mode === "all" ? "All" : mode === "review" ? "Needs review" : "Failed"}
							</button>
						))}
						<input
							className="text-[10px] rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] px-1.5 py-0.5 flex-1"
							onChange={(e) => setFilterTool(e.target.value)}
							placeholder="Filter by tool, run_id, or basin…"
							type="text"
							value={filterTool}
						/>
					</div>

					<div className="grid grid-cols-[minmax(340px,42%)_1fr] flex-1 min-h-0">
						<div className="overflow-auto border-r border-[var(--vscode-panel-border)]">
							{filteredEntries.length === 0 ? (
								<div className="text-center py-8 opacity-55 text-[11px]">No matching runs.</div>
							) : (
								filteredEntries.map((entry, i) => (
									<RunListRow
										entry={entry}
										index={i}
										key={entry.run_id}
										onClick={() => setSelectedRunId(entry.run_id)}
										selected={selectedRunId === entry.run_id}
									/>
								))
							)}
						</div>
						<RunDetail data={data} entry={selectedEntry} />
					</div>

					<div className="shrink-0 border-t border-[var(--vscode-panel-border)] px-3 py-1 text-[9px] opacity-50 flex items-center gap-2">
						<span className="codicon codicon-keyboard text-[9px]" />
						↑↓ navigate · click run for detail · Esc clear selection
						<span className="ml-auto">
							{filteredEntries.length} of {data.entries.length} shown
						</span>
					</div>
				</div>
			)}
		</div>
	)
}
