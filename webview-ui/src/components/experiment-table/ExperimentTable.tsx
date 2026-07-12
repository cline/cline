import React, { useCallback, useEffect, useRef, useState } from "react"
import { PLATFORM_CONFIG } from "../../config/platform.config"

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
	sessionId: string
	experiment_id: string
	defn: ExperimentDefn
	results: ExperimentResults | null
	availableExperimentIds?: string[]
	sessionPath?: string
}

type SortDir = "asc" | "desc"
type MetricStatus = "pass" | "warn" | "fail" | "unknown"

const BUTTON_BASE =
	"text-[10px] rounded border border-[var(--vscode-panel-border)] px-2 py-0.5 bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed"

function postMessage(msg: unknown) {
	PLATFORM_CONFIG.postMessage(msg)
}

function fmt(v: number | null | undefined): string {
	if (v === null || v === undefined || Number.isNaN(v)) {
		return "—"
	}
	return v.toFixed(4)
}

function statusColor(status: string): string {
	switch (status) {
		case "complete":
			return "var(--vscode-testing-iconPassed)"
		case "partial":
		case "running":
			return "var(--vscode-testing-iconQueued)"
		case "error":
			return "var(--vscode-testing-iconFailed)"
		default:
			return "var(--vscode-disabledForeground)"
	}
}

function metricStatus(metric: string, value: number | null | undefined): MetricStatus {
	if (value === null || value === undefined) {
		return "unknown"
	}
	const key = metric.toLowerCase()
	if (["kge", "nse", "r2"].includes(key)) {
		if (value >= 0.7) {
			return "pass"
		}
		if (value >= 0.6) {
			return "warn"
		}
		return "fail"
	}
	return "unknown"
}

function metricStatusColor(status: MetricStatus): string {
	switch (status) {
		case "pass":
			return "var(--vscode-testing-iconPassed)"
		case "warn":
			return "var(--vscode-testing-iconQueued)"
		case "fail":
			return "var(--vscode-testing-iconFailed)"
		default:
			return "var(--vscode-disabledForeground)"
	}
}

async function copyText(text: string): Promise<void> {
	try {
		await navigator.clipboard?.writeText(text)
	} catch {
		console.warn("[ExperimentTable] Clipboard write was unavailable")
	}
}

function rowStatus(row: Record<string, unknown>, metrics: string[]): MetricStatus {
	const statuses = metrics.map((metric) => metricStatus(metric, (row[metric] as MetricCell | null)?.value))
	if (statuses.includes("fail")) {
		return "fail"
	}
	if (statuses.includes("warn")) {
		return "warn"
	}
	if (statuses.includes("pass")) {
		return "pass"
	}
	return "unknown"
}

const RunChip: React.FC<{ runId: string | null | undefined; sessionId: string }> = ({ runId, sessionId }) => {
	if (!runId) {
		return <span className="opacity-35 text-[9px]">—</span>
	}
	const short = runId.replace(/^run\./, "")
	return (
		<button
			className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded border border-[var(--vscode-panel-border)] font-mono bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] hover:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)]"
			onClick={(event) => {
				event.stopPropagation()
				postMessage({ type: "open_replay", session_id: sessionId, run_id: runId })
			}}
			title={`${runId} · open Session Replay`}
			type="button">
			<span className="codicon codicon-debug-rerun text-[8px]" />
			<span>open</span>
			<span className="opacity-70">{short}</span>
		</button>
	)
}

const SortHeader: React.FC<{ col: string; sortCol: string; sortDir: SortDir; onSort: (col: string) => void }> = ({
	col,
	sortCol,
	sortDir,
	onSort,
}) => {
	const active = col === sortCol
	return (
		<th
			className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap border-b border-[var(--vscode-panel-border)] hover:bg-[var(--vscode-list-hoverBackground)]"
			onClick={() => onSort(col)}>
			{col === "feature_id" ? "Basin / feature" : col === "row_status" ? "Review" : col.replace(/_/g, " ")}
			{active && (
				<span className={`codicon ml-1 text-[9px] ${sortDir === "asc" ? "codicon-arrow-up" : "codicon-arrow-down"}`} />
			)}
		</th>
	)
}

export const ExperimentTable: React.FC = () => {
	const [sessionId, setSessionId] = useState("")
	const [experimentId, setExperimentId] = useState("")
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [emptyMessage, setEmptyMessage] = useState<string | null>(null)
	const [data, setData] = useState<ExperimentData | null>(null)
	const [sortCol, setSortCol] = useState<string>("feature_id")
	const [sortDir, setSortDir] = useState<SortDir>("asc")
	const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null)
	const [recentSessions, setRecentSessions] = useState<string[]>([])
	const listenerRef = useRef<((e: MessageEvent) => void) | null>(null)

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const msg = event.data
			if (!msg?.type) {
				return
			}
			if (msg.type === "experiment_table_data") {
				const resolvedExperimentId = String(msg.experiment_id ?? "")
				setExperimentId(resolvedExperimentId)
				setData({
					sessionId: String(msg.session_id ?? msg.session_path ?? ""),
					experiment_id: msg.experiment_id,
					defn: msg.defn,
					results: msg.results,
					availableExperimentIds: msg.available_experiment_ids ?? [],
					sessionPath: msg.session_path,
				})
				setLoading(false)
				setError(null)
				setEmptyMessage(null)
			} else if (msg.type === "experiment_table_empty") {
				setData(null)
				setError(null)
				setEmptyMessage(msg.message ?? "No experiments found in this session.")
				setLoading(false)
			} else if (msg.type === "experiment_table_error") {
				setError(msg.message ?? "Unknown error")
				setLoading(false)
			} else if (msg.type === "session_list") {
				setRecentSessions(Array.isArray(msg.sessions) ? msg.sessions.map(String) : [])
			} else if (msg.type === "load_experiment") {
				const sid = String(msg.session_id ?? "")
				const eid = String(msg.experiment_id ?? "")
				setSessionId(sid)
				setExperimentId(eid)
				if (sid.trim()) {
					setLoading(true)
					setError(null)
					setEmptyMessage(null)
					setData(null)
					postMessage({ type: "load_experiment", session_id: sid.trim(), experiment_id: eid.trim() || undefined })
				}
			}
		}
		postMessage({ type: "list_sessions" })
		window.addEventListener("message", handler)
		listenerRef.current = handler
		return () => window.removeEventListener("message", handler)
	}, [])

	const load = useCallback(() => {
		if (!sessionId.trim()) {
			setError("Enter a session_id/path. Experiment id is optional and auto-selected when available.")
			return
		}
		setLoading(true)
		setError(null)
		setEmptyMessage(null)
		setData(null)
		postMessage({ type: "load_experiment", session_id: sessionId.trim(), experiment_id: experimentId.trim() || undefined })
	}, [sessionId, experimentId])

	const loadDemo = useCallback(() => {
		setSessionId("demo-reproducibility-cockpit")
		setExperimentId("panel_smoke_exp")
		setLoading(true)
		setError(null)
		setEmptyMessage(null)
		setData(null)
		postMessage({ type: "load_experiment", session_id: "demo-reproducibility-cockpit", experiment_id: "panel_smoke_exp" })
	}, [])

	const tableData = React.useMemo(() => {
		if (!data?.defn || !data.results) {
			return null
		}
		const { defn, results } = data
		const metrics = defn.metrics
		const metricHasCi = Object.fromEntries(
			metrics.map((metric) => [
				metric,
				Object.values(results.cells).some((fc) => fc[metric]?.ci_low !== undefined || fc[metric]?.ci_high !== undefined),
			]),
		) as Record<string, boolean>
		const rows = defn.features
			.filter((feature) => feature in results.cells || feature in (results.errors ?? {}))
			.map((feature) => {
				const row: Record<string, unknown> = { feature_id: feature }
				if (results.errors?.[feature]) {
					row._error = results.errors[feature]
					row.run_id = null
					row.row_status = "fail"
					return row
				}
				const fc = results.cells[feature] ?? {}
				for (const metric of metrics) {
					row[metric] = fc[metric] ?? null
				}
				row.run_id = results.run_ids?.[feature] ?? null
				row.row_status = rowStatus(row, metrics)
				return row
			})
		const columns = ["feature_id", "row_status", ...metrics, "run_id"]
		const agg: Record<string, { mean: number; min: number; max: number; std: number; n: number }> = {}
		for (const metric of metrics) {
			const vals = rows
				.map((row) => (row[metric] as MetricCell | null)?.value)
				.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
			if (vals.length) {
				const mean = vals.reduce((a, b) => a + b, 0) / vals.length
				const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length > 1 ? vals.length - 1 : 1)
				agg[metric] = {
					mean: +mean.toFixed(4),
					min: +Math.min(...vals).toFixed(4),
					max: +Math.max(...vals).toFixed(4),
					std: +Math.sqrt(variance).toFixed(4),
					n: vals.length,
				}
			}
		}
		const statusCounts = rows.reduce<Record<MetricStatus, number>>(
			(acc, row) => {
				const status = String(row.row_status) as MetricStatus
				acc[status] = (acc[status] ?? 0) + 1
				return acc
			},
			{ pass: 0, warn: 0, fail: 0, unknown: 0 },
		)
		const metricCheckCounts = metrics.reduce<Record<MetricStatus, number>>(
			(acc, metric) => {
				for (const row of rows) {
					const status = metricStatus(metric, (row[metric] as MetricCell | null)?.value)
					if (status !== "unknown") {
						acc[status] = (acc[status] ?? 0) + 1
					}
				}
				return acc
			},
			{ pass: 0, warn: 0, fail: 0, unknown: 0 },
		)
		return { columns, rows, metrics, metricHasCi, agg, statusCounts, metricCheckCounts }
	}, [data])

	const interpretation = React.useMemo(() => {
		if (!tableData || !data) {
			return ""
		}
		const total = tableData.rows.length
		const pass = tableData.statusCounts.pass ?? 0
		const warn = tableData.statusCounts.warn ?? 0
		const fail = tableData.statusCounts.fail ?? 0
		if (fail > 0) {
			return `${pass}/${total} basins pass monitored skill metrics; ${warn} need caution and ${fail} fail at least one threshold. Review failed rows before citing this experiment.`
		}
		if (warn > 0) {
			return `${pass}/${total} basins pass monitored skill metrics; ${warn} need review before publication.`
		}
		return `${pass}/${total} basins pass monitored skill metrics for this experiment.`
	}, [tableData, data])

	const handleRowClick = useCallback((featureId: string) => {
		setSelectedFeatureId((prev) => (prev === featureId ? null : featureId))
		postMessage({ type: "highlight_experiment_feature", feature_id: featureId })
	}, [])

	const handleSort = (col: string) => {
		setSortDir((dir) => (col === sortCol ? (dir === "asc" ? "desc" : "asc") : "asc"))
		setSortCol(col)
	}

	const sortedRows = React.useMemo(() => {
		if (!tableData) {
			return []
		}
		return [...tableData.rows].sort((a, b) => {
			const av =
				sortCol === "run_id" || sortCol === "feature_id" || sortCol === "row_status"
					? a[sortCol]
					: (a[sortCol] as MetricCell | null)?.value
			const bv =
				sortCol === "run_id" || sortCol === "feature_id" || sortCol === "row_status"
					? b[sortCol]
					: (b[sortCol] as MetricCell | null)?.value
			if (av === null || av === undefined) {
				return 1
			}
			if (bv === null || bv === undefined) {
				return -1
			}
			const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
			return sortDir === "asc" ? cmp : -cmp
		})
	}, [tableData, sortCol, sortDir])

	return (
		<div
			className="flex flex-col h-full w-full bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)]"
			style={{ fontFamily: "var(--vscode-font-family)" }}>
			<div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--vscode-panel-border)] shrink-0">
				<span className="codicon codicon-table text-[14px] opacity-75" />
				<span className="text-sm font-semibold">Experiment Table</span>
				{data && <span className="text-[10px] opacity-55 font-mono ml-1 truncate max-w-[260px]">{data.defn.name}</span>}
				<div className="ml-auto flex items-center gap-2">
					<input
						className="text-[10px] rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] px-1.5 py-0.5 w-64"
						list="aihydro-experiment-recent-sessions"
						onChange={(e) => setSessionId(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && load()}
						placeholder="session_id or capsule path"
						type="text"
						value={sessionId}
					/>
					<input
						className="text-[10px] rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] px-1.5 py-0.5 w-44"
						onChange={(e) => setExperimentId(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && load()}
						placeholder="experiment optional"
						title="Optional: leave blank to auto-load the first available experiment"
						type="text"
						value={experimentId}
					/>
					<datalist id="aihydro-experiment-recent-sessions">
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
				<div className="mx-3 mt-2 px-2 py-1.5 rounded border border-[var(--vscode-testing-iconFailed)] text-[11px] text-[var(--vscode-testing-iconFailed)] bg-[var(--vscode-editor-background)]">
					<span className="codicon codicon-error text-[10px] mr-1" />
					{error}
				</div>
			)}

			{emptyMessage && !loading && !error && (
				<div className="flex flex-col items-center justify-center flex-1 opacity-75 text-center px-6">
					<span className="codicon codicon-table text-[32px] mb-2" />
					<p className="text-sm font-semibold">No experiment table for this session yet.</p>
					<p className="text-[11px] mt-1 max-w-[680px] opacity-80">{emptyMessage}</p>
					<p className="text-[11px] mt-2 max-w-[680px] opacity-70">
						Use <strong>Session Replay</strong> for tool-level provenance now. Create an experiment only when you want
						a cross-basin/model metric matrix.
					</p>
				</div>
			)}

			{!data && !loading && !error && !emptyMessage && (
				<div className="flex flex-col items-center justify-center flex-1 opacity-65 text-center px-4">
					<span className="codicon codicon-table text-[32px] mb-2" />
					<p className="text-sm">Load an experiment to inspect metric results, uncertainty, and provenance runs.</p>
					{recentSessions.length > 0 && (
						<p className="text-[10px] mt-1 opacity-75">Recent sessions: {recentSessions.slice(0, 5).join(", ")}</p>
					)}
				</div>
			)}

			{loading && (
				<div className="flex items-center justify-center flex-1 opacity-50">
					<span className="codicon codicon-loading codicon-modifier-spin text-[20px] mr-2" />
					<span className="text-sm">Loading experiment…</span>
				</div>
			)}

			{data && tableData && !loading && (
				<div className="flex flex-col flex-1 overflow-hidden px-3 py-2 gap-2">
					<div className="grid grid-cols-4 gap-2 shrink-0">
						<div className="rounded border border-[var(--vscode-panel-border)] px-2 py-1 text-[10px]">
							<span className="opacity-65">status</span>
							<div className="font-mono" style={{ color: statusColor(data.results?.status ?? "pending") }}>
								{data.results?.status ?? "pending"}
							</div>
						</div>
						<div className="rounded border border-[var(--vscode-panel-border)] px-2 py-1 text-[10px]">
							<span className="opacity-65">basins</span>
							<div className="font-mono">
								<span style={{ color: metricStatusColor("pass") }}>{tableData.statusCounts.pass} pass</span> ·{" "}
								<span style={{ color: metricStatusColor("warn") }}>{tableData.statusCounts.warn} review</span> ·{" "}
								<span style={{ color: metricStatusColor("fail") }}>{tableData.statusCounts.fail} fail</span>
							</div>
						</div>
						<div className="rounded border border-[var(--vscode-panel-border)] px-2 py-1 text-[10px]">
							<span className="opacity-65">metric checks</span>
							<div className="font-mono">
								<span style={{ color: metricStatusColor("pass") }}>{tableData.metricCheckCounts.pass} pass</span>{" "}
								·{" "}
								<span style={{ color: metricStatusColor("warn") }}>{tableData.metricCheckCounts.warn} warn</span>{" "}
								·{" "}
								<span style={{ color: metricStatusColor("fail") }}>{tableData.metricCheckCounts.fail} fail</span>
							</div>
						</div>
						<div
							className="rounded border border-[var(--vscode-panel-border)] px-2 py-1 text-[10px] truncate"
							title={data.sessionPath}>
							<div className="flex items-center gap-1">
								<span className="opacity-65">source</span>
								{data.sessionPath && (
									<button
										className="ml-auto codicon codicon-copy text-[10px] bg-transparent text-[var(--vscode-foreground)] border-0 hover:text-[var(--vscode-textLink-foreground)]"
										onClick={() => void copyText(data.sessionPath ?? "")}
										title="Copy source path"
										type="button"
									/>
								)}
							</div>
							<div className="font-mono truncate">{data.sessionPath ?? data.experiment_id}</div>
						</div>
					</div>

					<div className="rounded border border-[var(--vscode-panel-border)] px-2 py-1.5 text-[11px] bg-[var(--vscode-list-inactiveSelectionBackground)]">
						<span className="codicon codicon-lightbulb text-[11px] mr-1" />
						{interpretation}
					</div>

					{(data.availableExperimentIds?.length ?? 0) > 1 && (
						<div className="flex items-center gap-1.5 text-[10px] shrink-0">
							<span className="opacity-60">Experiments in this session:</span>
							{data.availableExperimentIds?.map((id) => (
								<button
									className={`${BUTTON_BASE} ${id === data.experiment_id ? "border-[var(--vscode-focusBorder)]" : ""}`}
									key={id}
									onClick={() => {
										setExperimentId(id)
										setLoading(true)
										postMessage({
											type: "load_experiment",
											session_id: data.sessionPath ?? data.sessionId,
											experiment_id: id,
										})
									}}
									type="button">
									{id}
								</button>
							))}
						</div>
					)}

					<div className="flex-1 overflow-auto rounded border border-[var(--vscode-panel-border)]">
						<table className="text-[10px] border-collapse w-full">
							<thead className="sticky top-0 bg-[var(--vscode-editor-background)] z-10">
								<tr>
									{tableData.columns.map((col) => (
										<SortHeader col={col} key={col} onSort={handleSort} sortCol={sortCol} sortDir={sortDir} />
									))}
								</tr>
							</thead>
							<tbody>
								{sortedRows.map((row, i) => {
									const fid = String(row.feature_id)
									const isSelected = fid === selectedFeatureId
									const review = String(row.row_status) as MetricStatus
									return (
										<tr
											className={[
												"border-b border-[var(--vscode-panel-border)] cursor-pointer",
												isSelected
													? "outline outline-1 outline-[var(--vscode-focusBorder)] shadow-[inset_3px_0_0_var(--vscode-focusBorder)] bg-[var(--vscode-list-hoverBackground)]"
													: i % 2 === 0
														? "hover:bg-[var(--vscode-list-hoverBackground)]"
														: "bg-[var(--vscode-list-inactiveSelectionBackground)] hover:bg-[var(--vscode-list-hoverBackground)]",
											].join(" ")}
											key={fid}
											onClick={() => handleRowClick(fid)}
											title="Click row to highlight basin on map">
											<td className="px-2 py-1 font-mono font-semibold whitespace-nowrap">{fid}</td>
											<td className="px-2 py-1">
												<span
													className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--vscode-panel-border)]"
													style={{ color: metricStatusColor(review) }}>
													{review === "warn" ? "review" : review}
												</span>
											</td>
											{tableData.metrics.map((metric) => {
												const cell = row[metric] as MetricCell | null
												const status = metricStatus(metric, cell?.value)
												return (
													<td className="px-2 py-1 font-mono min-w-[110px]" key={metric}>
														<div className="flex items-center gap-1">
															<span className="font-semibold">{fmt(cell?.value)}</span>
															{status !== "unknown" && (
																<span
																	className="text-[8px] px-1 rounded border border-[var(--vscode-panel-border)]"
																	style={{ color: metricStatusColor(status) }}>
																	{status}
																</span>
															)}
														</div>
														{tableData.metricHasCi[metric] && (
															<div className="text-[8px] opacity-65">
																CI {fmt(cell?.ci_low)}–{fmt(cell?.ci_high)}
															</div>
														)}
													</td>
												)
											})}
											<td className="px-2 py-1">
												<RunChip
													runId={row.run_id as string | null}
													sessionId={data.sessionPath ?? data.sessionId}
												/>
											</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>

					{Object.keys(tableData.agg).length > 0 && (
						<div
							className="grid gap-2 shrink-0"
							style={{ gridTemplateColumns: `repeat(${Math.min(tableData.metrics.length, 3)}, 1fr)` }}>
							{tableData.metrics.map(
								(metric) =>
									tableData.agg[metric] && (
										<div
											className="text-[9px] rounded border border-[var(--vscode-panel-border)] px-2 py-1 bg-[var(--vscode-list-inactiveSelectionBackground)]"
											key={metric}>
											<div className="font-semibold opacity-75 mb-0.5 uppercase tracking-wide">
												{metric}
											</div>
											<div className="font-mono flex gap-3 flex-wrap">
												<span>
													<span className="opacity-55">mean </span>
													{fmt(tableData.agg[metric].mean)}
												</span>
												<span>
													<span className="opacity-55">±std </span>
													{fmt(tableData.agg[metric].std)}
												</span>
												<span>
													<span className="opacity-55">range </span>
													{fmt(tableData.agg[metric].min)}–{fmt(tableData.agg[metric].max)}
												</span>
											</div>
										</div>
									),
							)}
						</div>
					)}
					<div className="text-[9px] opacity-55 flex items-center gap-2 shrink-0">
						<span>Run chips open Session Replay at the selected run.</span>
						<span>Rows highlight matching map layers.</span>
						{selectedFeatureId && <span className="ml-auto font-mono">highlighting {selectedFeatureId}</span>}
					</div>
				</div>
			)}
		</div>
	)
}
