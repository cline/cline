import type React from "react"

export interface DistributionPoint {
	featureId: string
	value: number
	statusColor: string
}

interface MetricDistributionChartProps {
	metric: string
	points: DistributionPoint[]
	width?: number
	height?: number
}

function quantile(sorted: number[], q: number): number {
	const pos = (sorted.length - 1) * q
	const base = Math.floor(pos)
	const rest = pos - base
	if (sorted[base + 1] !== undefined) {
		return sorted[base] + rest * (sorted[base + 1] - sorted[base])
	}
	return sorted[base]
}

/**
 * Box + jittered-strip plot for one metric's distribution across basins.
 *
 * Whiskers run to the true min/max rather than the usual 1.5*IQR cutoff:
 * with the small basin counts typical of an AI-Hydro experiment (a handful
 * to a few dozen), the 1.5*IQR outlier rule is statistically unstable and
 * would silently hide real, plottable data points as "outliers" beyond the
 * whisker. True min/max keeps every basin visible.
 *
 * Status color (pass/warn/fail/unknown) reuses the same VS Code
 * testing-icon theme tokens as the table view's own metricStatusColor —
 * this chart deliberately does not introduce a new palette.
 */
export const MetricDistributionChart: React.FC<MetricDistributionChartProps> = ({ metric, points, width = 560, height = 56 }) => {
	const values = points.map((p) => p.value).filter((v) => Number.isFinite(v))
	if (values.length === 0) {
		return (
			<div className="text-[10px] opacity-55 px-2 py-3 rounded border border-[var(--vscode-panel-border)]">
				No numeric values for {metric}.
			</div>
		)
	}
	const sorted = [...values].sort((a, b) => a - b)
	const min = sorted[0]
	const max = sorted[sorted.length - 1]
	const q1 = quantile(sorted, 0.25)
	const median = quantile(sorted, 0.5)
	const q3 = quantile(sorted, 0.75)

	const marginX = 8
	const plotW = width - marginX * 2
	const span = max - min || 1
	const x = (v: number) => marginX + ((v - min) / span) * plotW

	const boxTop = height * 0.32
	const boxBottom = height * 0.68
	const boxMid = height / 2
	const stripTop = height * 0.14
	const stripBottom = height * 0.86

	// Deterministic jitter (seeded by index, not Math.random) so the same
	// data always renders the same layout across re-renders.
	const jitterFor = (i: number) => {
		const t = ((i * 9301 + 49297) % 233280) / 233280
		return stripTop + t * (stripBottom - stripTop)
	}

	const fmtTick = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3))

	return (
		<div className="rounded border border-[var(--vscode-panel-border)] px-2 py-1.5">
			<div className="flex items-center justify-between mb-0.5">
				<span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{metric}</span>
				<span className="text-[9px] font-mono opacity-55">n={values.length}</span>
			</div>
			<svg height={height} role="img" viewBox={`0 0 ${width} ${height}`} width="100%">
				<title>
					{metric} distribution across {values.length} basins: min {fmtTick(min)}, median {fmtTick(median)}, max{" "}
					{fmtTick(max)}
				</title>
				{/* Whisker line (min-max, true range — see component docstring) */}
				<line
					stroke="var(--vscode-descriptionForeground)"
					strokeWidth={1}
					x1={x(min)}
					x2={x(max)}
					y1={boxMid}
					y2={boxMid}
				/>
				<line
					stroke="var(--vscode-descriptionForeground)"
					strokeWidth={1}
					x1={x(min)}
					x2={x(min)}
					y1={boxTop}
					y2={boxBottom}
				/>
				<line
					stroke="var(--vscode-descriptionForeground)"
					strokeWidth={1}
					x1={x(max)}
					x2={x(max)}
					y1={boxTop}
					y2={boxBottom}
				/>
				{/* IQR box */}
				<rect
					fill="var(--vscode-editor-background)"
					height={boxBottom - boxTop}
					rx={2}
					stroke="var(--vscode-focusBorder)"
					strokeWidth={1.5}
					width={Math.max(1, x(q3) - x(q1))}
					x={x(q1)}
					y={boxTop}
				/>
				{/* Median line */}
				<line
					stroke="var(--vscode-focusBorder)"
					strokeWidth={2}
					x1={x(median)}
					x2={x(median)}
					y1={boxTop}
					y2={boxBottom}
				/>
				{/* Jittered strip of individual basin points, colored by pass/warn/fail status */}
				{points.map((p, i) => (
					<circle
						cx={x(p.value)}
						cy={jitterFor(i)}
						fill={p.statusColor}
						key={p.featureId}
						r={2.5}
						stroke="var(--vscode-editor-background)"
						strokeWidth={0.5}>
						<title>
							{p.featureId}: {fmtTick(p.value)}
						</title>
					</circle>
				))}
			</svg>
			<div className="flex justify-between text-[8px] font-mono opacity-55 mt-0.5">
				<span>{fmtTick(min)}</span>
				<span>med {fmtTick(median)}</span>
				<span>{fmtTick(max)}</span>
			</div>
		</div>
	)
}
