import type React from "react"

interface MetricCell {
	value: number | null
	ci_low?: number | null
	ci_high?: number | null
	run_id?: string | null
}

interface DeltaExperimentSnapshot {
	experiment_id: string
	metrics: string[]
	cells: Record<string, Record<string, MetricCell>>
}

interface ExperimentDeltaViewProps {
	baseline: DeltaExperimentSnapshot
	comparison: DeltaExperimentSnapshot
}

// Metrics where a HIGHER value is better — used only to color the delta
// (green = improved, red = regressed). Unlisted metrics still show the
// numeric delta, just without a directional color judgement, since we don't
// know their polarity and coloring one arbitrarily would misrepresent it.
const HIGHER_IS_BETTER = new Set(["kge", "nse", "r2", "kge_np"])
const LOWER_IS_BETTER = new Set(["rmse", "mae", "pbias", "bias"])

function fmt(v: number | null | undefined): string {
	if (v === null || v === undefined || Number.isNaN(v)) {
		return "—"
	}
	return v.toFixed(4)
}

function deltaColor(metric: string, delta: number): string {
	const key = metric.toLowerCase()
	if (Math.abs(delta) < 1e-9) {
		return "var(--vscode-foreground)"
	}
	const improved = HIGHER_IS_BETTER.has(key) ? delta > 0 : LOWER_IS_BETTER.has(key) ? delta < 0 : null
	if (improved === null) {
		return "var(--vscode-foreground)"
	}
	return improved ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)"
}

/**
 * Paired per-basin, per-metric delta between two experiments in the same
 * session. A plain delta table, not a new chart form — per-row pairwise
 * comparison across several metrics is a table's job, not a plot's.
 */
export const ExperimentDeltaView: React.FC<ExperimentDeltaViewProps> = ({ baseline, comparison }) => {
	const metrics = baseline.metrics.filter((m) => comparison.metrics.includes(m))
	const featureIds = Array.from(new Set([...Object.keys(baseline.cells), ...Object.keys(comparison.cells)])).sort()

	if (metrics.length === 0) {
		return (
			<div className="text-[10px] opacity-55 px-2 py-3 rounded border border-[var(--vscode-panel-border)]">
				{baseline.experiment_id} and {comparison.experiment_id} share no common metrics to compare.
			</div>
		)
	}

	return (
		<div className="rounded border border-[var(--vscode-panel-border)] overflow-auto">
			<table className="text-[10px] border-collapse w-full">
				<thead className="sticky top-0 bg-[var(--vscode-editor-background)] z-10">
					<tr>
						<th className="px-2 py-1 text-left font-semibold uppercase tracking-wide border-b border-[var(--vscode-panel-border)]">
							Basin / feature
						</th>
						{metrics.map((metric) => (
							<th
								className="px-2 py-1 text-left font-semibold uppercase tracking-wide border-b border-[var(--vscode-panel-border)] whitespace-nowrap"
								key={metric}
								title={`${baseline.experiment_id} → ${comparison.experiment_id}`}>
								{metric} Δ
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{featureIds.map((fid, i) => (
						<tr
							className={`border-b border-[var(--vscode-panel-border)] ${i % 2 === 0 ? "" : "bg-[var(--vscode-list-inactiveSelectionBackground)]"}`}
							key={fid}>
							<td className="px-2 py-1 font-mono font-semibold whitespace-nowrap">{fid}</td>
							{metrics.map((metric) => {
								const baseVal = baseline.cells[fid]?.[metric]?.value
								const compVal = comparison.cells[fid]?.[metric]?.value
								if (typeof baseVal !== "number" || typeof compVal !== "number") {
									return (
										<td className="px-2 py-1 font-mono opacity-40" key={metric}>
											—
										</td>
									)
								}
								const delta = compVal - baseVal
								return (
									<td className="px-2 py-1 font-mono" key={metric}>
										<span title={`${fmt(baseVal)} → ${fmt(compVal)}`}>{fmt(baseVal)}</span>
										<span className="mx-1 opacity-40">→</span>
										<span style={{ color: deltaColor(metric, delta) }}>
											{fmt(compVal)} ({delta >= 0 ? "+" : ""}
											{fmt(delta)})
										</span>
									</td>
								)
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}
