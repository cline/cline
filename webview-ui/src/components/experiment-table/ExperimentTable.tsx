import React, { useCallback, useEffect, useRef, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExperimentDefn {
	experiment_id: string
	name: string
	tool: string
	features: string[]
	params: Record<string, unknown>
	metrics: string[]
	params_hash: string
	created_at: string
}

interface MetricCell {
	value: number | null
	ci_low?: number | null
	ci_high?: number | null
	run_id?: string | null
}

interface ExperimentResults {
	status: "pending" | "running" | "complete" | "partial" | "error"
	run_ids: Record<string, string>
	cells: Record<string, Record<string, MetricCell>>
	errors: Record<string, string>
	n_success: number
	n_error: number
	completed_at: string | null
}

interface ExperimentData {
	experiment_id: string
	defn: ExperimentDefn
	results: ExperimentResults | null
}

type SortDir = "asc" | "desc"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const vscode = (window as any).acquireVsCodeApi?.()

function postMessage(msg: unknown) {
	vscode?.postMessage(msg)
}

function fmt(v: number | null | undefined): string {
	if (v === null || v === undefined) return "—"
	return v.toFixed(4)
}

function statusColor(status: string): string {
	switch (status) {
		case "complete":
			return "var(--vscode-testing-iconPassed)"
		case "partial":
			return "var(--vscode-testing-iconQueued)"
		case "error":
			return "var(--vscode-testing-iconFailed)"
		case "running":
			return "var(--vscode-textLink-foreground)"
		default:
			return "var(--vscode-disabledForeground)"
	}
}

// ---------------------------------------------------------------------------
// RunChip — minimal inline run_id chip
// ---------------------------------------------------------------------------

const RunChip: React.FC<{ runId: string | null | undefined }> = ({ runId }) => {
	if (!runId) return <span className="opacity-30 text-[9px]">—</span>
	const short = runId.split(".").slice(0, 2).join(".")
	return (
		<span
			className="inline-flex items-center gap-0.5 px-1 py-0 text-[9px] rounded border border-[var(--vscode-panel-border)] font-mono opacity-80"
			title={runId}>
			<span className="codicon codicon-run-all text-[8px]" />
			{short}
		</span>
	)
}

// ---------------------------------------------------------------------------
// SortHeader
// ---------------------------------------------------------------------------

const SortHeader: React.FC<{
	col: string
	sortCol: string
	sortDir: SortDir
	onSort: (col: string) => void
}> = ({ col, sortCol, sortDir, onSort }) => {
	const active = col === sortCol
	return (
		<th
			className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap border-b border-[var(--vscode-panel-border)] hover:bg-[var(--vscode-list-hoverBackground)]"
			onClick={() => onSort(col)}>
			{col.replace(/_/g, " ")}
			{active && (
				<span className={`codicon ml-1 text-[9px] ${sortDir === "asc" ? "codicon-arrow-up" : "codicon-arrow-down"}`} />
			)}
		</th>
	)
}

// ---------------------------------------------------------------------------
// ExperimentTable root
// ---------------------------------------------------------------------------

export const ExperimentTable: React.FC = () => {
	const [sessionId, setSessionId] = useState("")
	const [experimentId, setExperimentId] = useState("")
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [data, setData] = useState<ExperimentData | null>(null)
	const [sortCol, setSortCol] = useState<string>("feature_id")
	const [sortDir, setSortDir] = useState<SortDir>("asc")
	const listenerRef = useRef<((e: MessageEvent) => void) | null>(null)

	// Listen for messages from the extension host
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const msg = event.data
			if (!msg?.type) return
			if (msg.type === "experiment_table_data") {
				setData({ experiment_id: msg.experiment_id, defn: msg.defn, results: msg.results })
				setLoading(false)
				setError(null)
			} else if (msg.type === "experiment_table_error") {
				setError(msg.message ?? "Unknown error")
				setLoading(false)
			}
		}
		window.addEventListener("message", handler)
		listenerRef.current = handler
		return () => window.removeEventListener("message", handler)
	}, [])

	const load = useCallback(() => {
		if (!sessionId.trim() || !experimentId.trim()) {
			setError("Enter both session_id and experiment_id.")
			return
		}
		setLoading(true)
		setError(null)
		setData(null)
		postMessage({ type: "load_experiment", session_id: sessionId.trim(), experiment_id: experimentId.trim() })
	}, [sessionId, experimentId])

	// ---------------------------------------------------------------------------
	// Build table rows from raw session data
	// ---------------------------------------------------------------------------

	const tableData = React.useMemo(() => {
		if (!data?.defn || !data.results) return null
		const { defn, results } = data
		const metrics = defn.metrics

		const hasCi = Object.values(results.cells).some((fc) => Object.values(fc).some((c) => c.ci_low !== undefined))

		const columns = [
			"feature_id",
			...metrics,
			...(hasCi ? metrics.flatMap((m) => [`${m}_ci_low`, `${m}_ci_high`]) : []),
			"run_id",
		]

		const rows = defn.features
			.filter((f) => f in results.cells || f in (results.errors ?? {}))
			.map((feature) => {
				const row: Record<string, unknown> = { feature_id: feature }
				if (results.errors?.[feature]) {
					row._error = results.errors[feature]
					row.run_id = null
					return row
				}
				const fc = results.cells[feature] ?? {}
				for (const m of metrics) {
					const cell = fc[m]
					row[m] = cell?.value ?? null
					if (hasCi) {
						row[`${m}_ci_low`] = cell?.ci_low ?? null
						row[`${m}_ci_high`] = cell?.ci_high ?? null
					}
				}
				row.run_id = results.run_ids?.[feature] ?? null
				return row
			})

		// Aggregate stats
		const agg: Record<string, { mean: number; min: number; max: number; n: number }> = {}
		for (const m of metrics) {
			const vals = rows.filter((r) => r[m] !== null && r[m] !== undefined && !r._error).map((r) => r[m] as number)
			if (vals.length) {
				const mean = vals.reduce((a, b) => a + b, 0) / vals.length
				agg[m] = {
					mean: +mean.toFixed(4),
					min: +Math.min(...vals).toFixed(4),
					max: +Math.max(...vals).toFixed(4),
					n: vals.length,
				}
			}
		}

		return { columns, rows, metrics, hasCi, agg }
	}, [data])

	// ---------------------------------------------------------------------------
	// Sort
	// ---------------------------------------------------------------------------

	const handleSort = (col: string) => {
		setSortDir((d) => (col === sortCol ? (d === "asc" ? "desc" : "asc") : "asc"))
		setSortCol(col)
	}

	const sortedRows = React.useMemo(() => {
		if (!tableData) return []
		return [...tableData.rows].sort((a, b) => {
			const av = a[sortCol]
			const bv = b[sortCol]
			if (av === null || av === undefined) return 1
			if (bv === null || bv === undefined) return -1
			const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
			return sortDir === "asc" ? cmp : -cmp
		})
	}, [tableData, sortCol, sortDir])

	// ---------------------------------------------------------------------------
	// Render
	// ---------------------------------------------------------------------------

	return (
		<div
			className="flex flex-col h-full w-full bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)]"
			style={{ fontFamily: "var(--vscode-font-family)" }}>
			{/* Top bar */}
			<div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--vscode-panel-border)] shrink-0">
				<span className="codicon codicon-table text-[14px] opacity-70" />
				<span className="text-sm font-semibold">Experiment Table</span>
				{data && <span className="text-[10px] opacity-50 font-mono ml-1 truncate max-w-[200px]">{data.defn.name}</span>}
				<div className="ml-auto flex items-center gap-2">
					<input
						className="text-[10px] rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] px-1.5 py-0.5 w-36"
						onChange={(e) => setSessionId(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && load()}
						placeholder="session_id"
						type="text"
						value={sessionId}
					/>
					<input
						className="text-[10px] rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] px-1.5 py-0.5 w-36"
						onChange={(e) => setExperimentId(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && load()}
						placeholder="experiment_id"
						type="text"
						value={experimentId}
					/>
					<button
						className="text-[10px] rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] px-2 py-0.5 cursor-pointer hover:opacity-90 disabled:opacity-50"
						disabled={loading}
						onClick={load}
						type="button">
						{loading ? "Loading…" : "Load"}
					</button>
				</div>
			</div>

			{/* Error */}
			{error && (
				<div className="mx-3 mt-2 px-2 py-1.5 rounded border border-[var(--vscode-testing-iconFailed)] text-[11px] text-[var(--vscode-testing-iconFailed)] bg-[var(--vscode-editor-background)]">
					<span className="codicon codicon-error text-[10px] mr-1" />
					{error}
				</div>
			)}

			{/* Empty state */}
			{!data && !loading && !error && (
				<div className="flex flex-col items-center justify-center flex-1 opacity-40">
					<span className="codicon codicon-table text-[32px] mb-2" />
					<p className="text-sm">Enter a session_id and experiment_id to view results.</p>
					<p className="text-[11px] mt-1 opacity-70">
						Run <code>define_experiment</code> + <code>run_experiment</code> in the chat first.
					</p>
				</div>
			)}

			{/* Loading spinner */}
			{loading && (
				<div className="flex items-center justify-center flex-1 opacity-50">
					<span className="codicon codicon-loading codicon-modifier-spin text-[20px] mr-2" />
					<span className="text-sm">Loading experiment…</span>
				</div>
			)}

			{/* Table */}
			{data && tableData && !loading && (
				<div className="flex flex-col flex-1 overflow-hidden px-3 py-2 gap-2">
					{/* Metadata strip */}
					<div className="flex items-center gap-3 text-[10px] opacity-60 shrink-0">
						<span>
							<span className="opacity-70">tool:</span> <span className="font-mono">{data.defn.tool}</span>
						</span>
						<span>
							<span className="opacity-70">status:</span>{" "}
							<span style={{ color: statusColor(data.results?.status ?? "pending") }}>
								{data.results?.status ?? "pending"}
							</span>
						</span>
						<span>
							<span className="opacity-70">features:</span> {data.defn.features.length}
						</span>
						<span>
							<span className="opacity-70">success:</span> {data.results?.n_success ?? 0} /{" "}
							{data.defn.features.length}
						</span>
						{data.results?.completed_at && (
							<span className="ml-auto opacity-40 font-mono">
								{data.results.completed_at.slice(0, 16).replace("T", " ")} UTC
							</span>
						)}
					</div>

					{/* Scrollable table */}
					<div className="flex-1 overflow-auto">
						<table className="text-[10px] border-collapse w-full">
							<thead className="sticky top-0 bg-[var(--vscode-editor-background)] z-10">
								<tr>
									{tableData.columns.map((col) => (
										<SortHeader col={col} key={col} onSort={handleSort} sortCol={sortCol} sortDir={sortDir} />
									))}
								</tr>
							</thead>
							<tbody>
								{/* Aggregate row */}
								{Object.keys(tableData.agg).length > 0 && (
									<tr className="bg-[var(--vscode-list-inactiveSelectionBackground)] text-[9px] opacity-70 italic">
										<td className="px-2 py-0.5 font-semibold">Σ mean</td>
										{tableData.metrics.map((m) => (
											<React.Fragment key={m}>
												<td className="px-2 py-0.5 font-mono">
													{tableData.agg[m] ? fmt(tableData.agg[m].mean) : "—"}
												</td>
												{tableData.hasCi && (
													<>
														<td className="px-2 py-0.5" />
														<td className="px-2 py-0.5" />
													</>
												)}
											</React.Fragment>
										))}
										<td className="px-2 py-0.5" />
									</tr>
								)}

								{/* Data rows */}
								{sortedRows.map((row, i) => (
									<tr
										className={`border-b border-[var(--vscode-panel-border)] hover:bg-[var(--vscode-list-hoverBackground)] ${i % 2 === 0 ? "" : "bg-[var(--vscode-list-inactiveSelectionBackground)] bg-opacity-30"}`}
										key={String(row.feature_id)}>
										{tableData.columns.map((col) => {
											if (col === "run_id") {
												return (
													<td className="px-2 py-0.5" key={col}>
														<RunChip runId={row.run_id as string | null} />
													</td>
												)
											}
											const v = row[col]
											if ((row as any)._error && col !== "feature_id") {
												return col === tableData.columns[1] ? (
													<td
														className="px-2 py-0.5 text-[var(--vscode-testing-iconFailed)] italic"
														colSpan={tableData.columns.length - 1}
														key={col}>
														{(row as any)._error}
													</td>
												) : null
											}
											const isMetric = tableData.metrics.includes(col) || col.includes("_ci_")
											return (
												<td className={`px-2 py-0.5 ${isMetric ? "font-mono" : ""}`} key={col}>
													{typeof v === "number"
														? fmt(v)
														: v === null || v === undefined
															? "—"
															: String(v)}
												</td>
											)
										})}
									</tr>
								))}
							</tbody>
						</table>

						{sortedRows.length === 0 && (
							<div className="text-center py-8 opacity-40 text-[11px]">
								No results yet — call <code>run_experiment</code> first.
							</div>
						)}
					</div>

					{/* Aggregate footer */}
					{Object.keys(tableData.agg).length > 0 && (
						<div className="shrink-0 border-t border-[var(--vscode-panel-border)] pt-1 pb-0.5">
							<div className="flex flex-wrap gap-3 text-[9px] opacity-60">
								{tableData.metrics.map(
									(m) =>
										tableData.agg[m] && (
											<span key={m}>
												<span className="font-semibold">{m}:</span>{" "}
												<span className="font-mono">
													{fmt(tableData.agg[m].min)} – {fmt(tableData.agg[m].max)}{" "}
													<span className="opacity-50">(n={tableData.agg[m].n})</span>
												</span>
											</span>
										),
								)}
							</div>
							<p className="text-[9px] opacity-40 mt-0.5">
								To cite:{" "}
								<code>evidence_spans: [&#123;source_type: "run", source_id: "{data.experiment_id}"&#125;]</code>
							</p>
						</div>
					)}
				</div>
			)}
		</div>
	)
}
